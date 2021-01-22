/**
 * Plugin to convert com.here.pb.hdmap.external.v1.routing.RoutingAttributesLayerTile layers to GeoJSON.
 */
(function (exports) {
    "use strict";

    // Common module path
    const COMMON_MODULE = "com.here.pb.hdmap.shared.v1.core.Common";

    // Render configuration output type
    const OUTPUT_TYPE = "application/vnd.geo+json; charset=utf-8";

    // Road local attributes protobundle metadata
    const RELATIVE_SIDE_ENUM = "com.here.pb.hdmap.external.v1.common.RelativeSide";

    // Graphical options
    const LINK_WITH_ATTRIBUTIONS_COLOR = "#00CC00"; // light green
    const LINK_WITHOUT_ATTRIBUTIONS_COLOR = "#A0A0A0"; // light grey
    const LINK_LINE_WIDTH = 4;
    const LINK_POINT_RADIUS = 0.8;
    const LINK_ARROW_OPTIONS = {
        pointRadius: LINK_POINT_RADIUS,
        arrowSpacing: 50,
        arrowHeight: 2,
        arrowWidth: 1
    };

    const INFRA_SEP_LEFT = 1;
    const INFRA_SEP_RIGHT = 2;
    const INFRA_SEP_BOTH = 3;
    const INFRA_SEP_LEFT_BORDER_COLOR = "#008400EE"; // light green
    const INFRA_SEP_LEFT_FILL_COLOR = "#008400AA"; // transparent light green
    const INFRA_SEP_RIGHT_BORDER_COLOR = "#006400EE"; // dark green
    const INFRA_SEP_RIGHT_FILL_COLOR = "#004400AA"; // transparent dark green
    const INFRA_SEP_LINE_WIDTH = 3;
    const INFRA_SEP_SHIFT_DISTANCE = 2;

    const LANE_GROUP_LINE_WIDTH = 1.5;
    const LANE_GROUP_BORDER_COLOR = "#777777"; // light grey
    const LANE_GROUP_FILL_COLOR = "#222222A0"; // transparent dark grey

    const BARRIER_LINE_WIDTH = 3;
    const BARRIER_POINT_RADIUS = 0.5;
    const BARRIER_ALPHA_CHANNEL = "BB";
    const BARRIER_FEATURES_COLORS = [
        "#42D4F4" + BARRIER_ALPHA_CHANNEL, // cyan
        "#FF000D" + BARRIER_ALPHA_CHANNEL, // dark red
        "#FF0A16" + BARRIER_ALPHA_CHANNEL, // crimson red
        "#FFA114" + BARRIER_ALPHA_CHANNEL, // light ocher
        "#EB00A4" + BARRIER_ALPHA_CHANNEL, // pink
        "#000EA8" + BARRIER_ALPHA_CHANNEL  // dark blue
    ];

    // Enums
    const BARRIER_TYPE_ENUM = new Array();
    BARRIER_TYPE_ENUM[0] = "UNKNOWN";
    BARRIER_TYPE_ENUM[1] = "JERSEY_BARRIER";
    BARRIER_TYPE_ENUM[2] = "GUARDRAIL";
    BARRIER_TYPE_ENUM[3] = "CURB";
    BARRIER_TYPE_ENUM[4] = "WALL";
    BARRIER_TYPE_ENUM[5] = "FENCE";
    BARRIER_TYPE_ENUM[6] = "TUNNEL_WALL";

    const TOOLTIP_TILE_ID_COLOR = "#DDDDDD";

    /**
     * Converts the decoded tile information to GeoJSON features to render the IS attributions.
     *
     * This function is called automatically by the datastore inspector plugin.
     *
     * @param logger
     *              the datastore inspector plugin logger
     * @param layer
     *              the current catalog layer metadata
     * @param decodeResult
     *              the decoded data of the tile
     * @param context
     *              the datastore inspector plugin context
     *
     * @returns a promise with the GeoJSON features data to render
     */
    exports.promiseToGeoJSON = function (logger, layer, decodeResult, context, mapUtils) {
        const tile = decodeResult.decoded;
        if (!tile.link_attribution) {
            logger.info("Source data does not have any features lists. Make sure your are passing correct data to render.");
            return null;
        }

        logger.info("Initializing common modules.");
        const common = loadCommonModules(logger, layer, context, mapUtils);
        logger.info("Common modules initialized.");

        logger.info("Loading layers data.");
        const loader = new LayerLoader(logger, layer, context, common);
        const linkAttributions = loader.getLinkAttributions(tile);

        logger.info("Current context tileId: %s", context.partition);
        return loader.getLaneRoadReferencesTile().then(function (laneRoadReferencesTile) {
            const linkToLaneGroupReferences = laneRoadReferencesTile.link_lane_group_references || [];
            logger.info("Link to lane group references loaded: %d", linkToLaneGroupReferences.length);

            const referencedTileIds = loader.getReferencedTileIds(linkAttributions, linkToLaneGroupReferences);
            logger.info("Referenced tileIds: %s", JSON.stringify(referencedTileIds));

            return loader.loadAllData(referencedTileIds).then(function (features) {
                logger.info("Road local link attributions: %d", linkAttributions.length);
                const links = features.links;
                logger.info("Links loaded: %d", links.length);
                const laneGroups = features.laneGroups;
                logger.info("Lane groups loaded: %d", laneGroups.length);
                const barriers = features.barriers;
                logger.info("Barriers loaded: %d", barriers.length);
                const RelativeSideMetadata = features.RelativeSideMetadata;

                const renderer = new LayerRenderer(logger, context, common, RelativeSideMetadata);
                const geoJsonFeatures = []
                    .concat(renderer.renderLaneGroups(laneGroups, linkToLaneGroupReferences))
                    .concat(renderer.renderLinkAttributions(linkAttributions, links))
                    .concat(renderer.renderLinks(links, linkAttributions))
                    .concat(renderer.renderLocalizationBarriers(barriers));

                logger.info("Rendering geoJsonFeatures: %d", geoJsonFeatures.length);
                return {
                    contentType: OUTPUT_TYPE,
                    body: {
                        type: "FeatureCollection",
                        features: geoJsonFeatures
                    }
                };
            });
        }, function (err) {
            logger.error("Failure rendering:", err);
            return null;
        });
    }


    /* -------------------------------------------------
     * Loading of module dependencies.
     * -------------------------------------------------
     */

    /*
     * Loads the common modules.
     */
    function loadCommonModules(logger, layer, context, mapUtils) {
        const common = context.catApi.getPlugin(context.config, context.version, layer, COMMON_MODULE);
        return common.loadAll(logger, mapUtils, {
            mathUtils: {
                comparisonTolerance: 1e-12
            },
            context: context
        });
    };


    /* -------------------------------------------------
     * Functions for the setup and load of the involved tiles.
     * -------------------------------------------------
     */

    const LayerLoader = function (logger, layer, context, common) {

        const Long = common.mapUtils.requireLong();

        /*
         * Returns the road local link attributions binary data.
         */
        function getLinkAttributions(tile) {
            const decoder = new TileDecoder(logger, context, common);
            return decoder.getLinkAttributions(tile);
        }

        /*
         * Returns all the lane to road references for the current tile
         */
        function getLaneRoadReferencesTile() {
            return common.loader.loadExternalLaneRoadReferencesFromContext([context.partition]).then(function (tiles) {
                logger.info("Lanes road references loaded.");
                return (tiles.length > 0) ? tiles[0] : {};
            });
        }

        /*
         * TileIds of referenced data.
         */
        function getReferencedTileIds(linkAttributions, linkToLaneGroupReferences) {
            const linkTileIds = new Set([context.partition]);
            const laneGroupsIds = new Set([context.partition]);
            const barrierTileIds = new Set([context.partition]);
            for (const linkToLaneGroupRef of linkToLaneGroupReferences) {
                if (linkToLaneGroupRef.lane_group_references
                    && isLinkRefWithAttributions(linkToLaneGroupRef.link_local_ref, linkAttributions)) {
                    for (const laneGroupRef of linkToLaneGroupRef.lane_group_references) {
                        const hereTileId = "" + laneGroupRef.lane_group_ref.lane_group_here_tile_id;
                        laneGroupsIds.add(hereTileId);
                        barrierTileIds.add(hereTileId);
                    }
                }
            }
            return {
                linkTileIds: Array.from(linkTileIds),
                laneGroupsIds: Array.from(laneGroupsIds),
                barrierTileIds: Array.from(barrierTileIds)
            };
        }

        function isLinkRefWithAttributions(linkRef, linkAttributions) {
            for (const linkAttribution of linkAttributions) {
                if (linkAttribution.linkRef == linkRef
                    && linkAttribution.roadLocalAttributions.length > 0) {
                    return true;
                }
            }
            return false;
        }

        /*
         * Loads links and metadata.
         */
        function loadAllData(referencedTileIds) {
            const linksPromise = loadLinks(referencedTileIds.linkTileIds);
            const laneGroupsPromise = loadLaneGroups(referencedTileIds.laneGroupsIds);
            const barriersPromise = loadBarriers(referencedTileIds.barrierTileIds);
            const relativeSideMetadataPromise = loadEnumMetadata(RELATIVE_SIDE_ENUM);
            const promises = [
                linksPromise, laneGroupsPromise,
                barriersPromise, relativeSideMetadataPromise
            ];
            return Promise.all(promises).then(function (data) {
                const links = data[0];
                const laneGroups = data[1];
                const barriers = data[2];
                const RelativeSideMetadata = data[3];
                return {
                    links: links,
                    laneGroups: laneGroups,
                    barriers: barriers,
                    RelativeSideMetadata: RelativeSideMetadata
                };
            });
        }

        function loadLinks(tileIds) {
            return common.loader.loadExternalTopologyGeometryTilesFromContext(tileIds).then(function (tiles) {
                const links = [];
                for (const tile of tiles) {
                    if (tile.links_starting_in_tile) {
                        const tileCenter = Long.fromValue(tile.tile_center_here_2d_coordinate);
                        for (const link of tile.links_starting_in_tile) {
                            const platformGeometry = common.conversions.lineString2dOffsetToPlatform(
                                link.geometry, tileCenter);
                            links.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                platform_geometry: platformGeometry
                            }, link));
                        }
                    }
                }
                return links;
            });
        }

        function loadLaneGroups(tileIds) {
            return common.loader.loadExternalLaneTopologyTilesFromContext(tileIds).then(function (tiles) {
                const laneGroups = [];
                for (const tile of tiles) {
                    if (tile.lane_groups_starting_in_tile) {
                        const tileCenter = Long.fromValue(tile.tile_center_here_2d_coordinate);
                        for (const laneGroup of tile.lane_groups_starting_in_tile) {
                            let platformBoundaryGeometry = null;
                            if (laneGroup.boundary_geometry) {
                                const leftBoundary = common.conversions.lineString2dOffsetToPlatform(
                                    laneGroup.boundary_geometry.left_boundary, tileCenter);
                                const rightBoundary = common.conversions.lineString2dOffsetToPlatform(
                                    laneGroup.boundary_geometry.right_boundary, tileCenter);
                                platformBoundaryGeometry = {
                                    left_boundary: leftBoundary,
                                    right_boundary: rightBoundary
                                };
                            }
                            laneGroups.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                platform_boundary_geometry: platformBoundaryGeometry
                            }, laneGroup));
                        }
                    }
                }
                return laneGroups;
            });
        }

        function loadBarriers(tileIds) {
            return common.loader.loadExternalLocalBarrierTilesFromContext(tileIds).then(function (tiles) {
                const barriers = [];
                for (const tile of tiles) {
                    if (tile.barriers) {
                        const tileCenter = {
                            here_2d_coordinate: Long.fromValue(tile.tile_center_here_3d_coordinate.here_2d_coordinate),
                            cm_from_WGS84_ellipsoid: Long.fromValue(tile.tile_center_here_3d_coordinate.cm_from_WGS84_ellipsoid)
                        };
                        for (const barrier of tile.barriers) {
                            const platformTopGeometry = common.conversions.lineString3dOffsetToPlatform(
                                barrier.top_geometry, tileCenter);
                            barriers.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                platform_top_geometry: platformTopGeometry
                            }, barrier));
                        }
                    }
                }
                return barriers;
            });
        }

        function loadEnumMetadata(enumType) {
            return layer.protobufManager.getProtoBuilder(layer.manifest).then(function (protobuf) {
                return common.proto.findMetadata(protobuf, enumType);
            });
        }

        // Only what we want to expose
        return {
            getLinkAttributions: getLinkAttributions,
            getLaneRoadReferencesTile: getLaneRoadReferencesTile,
            getReferencedTileIds: getReferencedTileIds,
            loadAllData: loadAllData
        };
    };


    /* -------------------------------------------------
     * Functions for getting data of the current attribution tile.
     * -------------------------------------------------
     */

    const TileDecoder = function (logger, context, common) {

        function getLinkAttributions(tile) {
            const linkAttributions = [];
            if (tile.link_attribution) {
                for (const linkAttribution of tile.link_attribution) {
                    const attribution = getLinkAttribution(linkAttribution);
                    linkAttributions.push(attribution);
                }
            }
            return linkAttributions;
        }

        function getLinkAttribution(linkAttribution) {
            const roadLocalAttributions = [];
            if (linkAttribution.parametric_attribution) {
                for (const parametricAttribution of linkAttribution.parametric_attribution) {
                    const attributions = getRoadLocalAttributions(parametricAttribution);
                    roadLocalAttributions.pushArray(attributions);
                }
            }
            return {
                tileId: context.partition,
                linkRef: linkAttribution.link_local_ref,
                roadLocalAttributions: roadLocalAttributions
            };
        }

        function getRoadLocalAttributions(parametricAttribution) {
            const roadLocalAttributions = [];
            const infraSepAttributions = getInfraSepAttributions(parametricAttribution);
            if (infraSepAttributions.length > 0) {
                const range = getParametricAttributionRange(parametricAttribution);
                for (const infraSepAttribution of infraSepAttributions) {
                    const presentOnSide = infraSepAttribution.present_on_side;
                    roadLocalAttributions.push({
                        range: range,
                        presentOnSide: presentOnSide
                    });
                }
            }
            return roadLocalAttributions;
        }

        function getInfraSepAttributions(parametricAttribution) {
            const infraSepAttributions = [];
            if (parametricAttribution.link_parametric_attribution) {
                for (const linkParametricAttribution of parametricAttribution.link_parametric_attribution) {
                    if (linkParametricAttribution.infrastructure_separation) {
                        infraSepAttributions.push(linkParametricAttribution.infrastructure_separation);
                    }
                }
            }
            return infraSepAttributions;
        }

        function getParametricAttributionRange(parametricAttribution) {
            const start = (parametricAttribution.applies_to_range)
                ? (parametricAttribution.applies_to_range.range_offset_from_start || 0.0)
                : 0.0;
            const end = (parametricAttribution.applies_to_range)
                ? (parametricAttribution.applies_to_range.range_offset_from_end || 0.0)
                : 0.0;
            return {
                start: start,
                end: 1 - end
            };
        }

        // Only what we want to expose
        return {
            getLinkAttributions: getLinkAttributions
        };
    }


    /* -------------------------------------------------
     * Functions for rendering.
     * -------------------------------------------------
     */

    const LayerRenderer = function (logger, context, common, RelativeSideMetadata) {

        const Long = common.mapUtils.requireLong();

        /* -------------------------------------------------
         * Lane group rendering.
         * -------------------------------------------------
         */

        function renderLaneGroups(laneGroups, linkToLaneGroupReferences) {
            const geoJsonFeatures = [];
            for (const laneGroup of laneGroups) {
                const features = renderLaneGroup(laneGroup, linkToLaneGroupReferences);
                geoJsonFeatures.pushArray(features);
            }
            logger.info("Rendering %d geoJsonFeatures for lane groups.", geoJsonFeatures.length);
            return geoJsonFeatures;
        }

        function renderLaneGroup(laneGroup, linkToLaneGroupReferences) {
            const geoJsonFeatures = [];
            const geometry = laneGroup.platform_boundary_geometry;
            if (geometry && geometry.left_boundary && geometry.right_boundary) {
                const isReferenced = isLaneGroupReferencedByLink(laneGroup, linkToLaneGroupReferences);
                if (isReferenced || laneGroup.tile_id == context.partition) {
                    const borderColor = LANE_GROUP_BORDER_COLOR;
                    const fillColor = LANE_GROUP_FILL_COLOR;
                    const tooltip = buildLaneGroupTooltip(laneGroup);
                    const points = geometry.left_boundary.linestring_points
                        .concat(geometry.right_boundary.linestring_points.reverse());
                    const polygon = { linestring_points: points };

                    geoJsonFeatures.push(common.render.renderLineString2dPolygon(
                         polygon, borderColor, fillColor,
                         LANE_GROUP_LINE_WIDTH, tooltip));
                }
            }
            return geoJsonFeatures;
        }

        function isLaneGroupReferencedByLink(laneGroup, linkToLaneGroupReferences) {
            const tileId = laneGroup.tile_id;
            const laneGroupId = Long.fromValue(laneGroup.lane_group_id);
            for (const linkToLaneGroupRef of linkToLaneGroupReferences) {
                if (linkToLaneGroupRef.lane_group_references) {
                    for (const laneGroupRef of linkToLaneGroupRef.lane_group_references) {
                        if (laneGroupRef.lane_group_ref.lane_group_here_tile_id == tileId
                            && Long.fromValue(laneGroupRef.lane_group_ref.lane_group_id).equals(laneGroupId)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        function buildLaneGroupTooltip(laneGroup) {
            return `<b>Lane Group Id:</b> ${laneGroup.lane_group_id} ${buildTileIdTooltip(laneGroup.tile_id)}<br>`;
        }


        /* -------------------------------------------------
         * Road links rendering.
         * -------------------------------------------------
         */

        function renderLinks(links, linkAttributions) {
            const geoJsonFeatures = [];
            for (const link of links) {
                const features = renderLink(link, linkAttributions);
                geoJsonFeatures.pushArray(features);
            }
            logger.info("Rendering %d geoJsonFeatures for links.", geoJsonFeatures.length);
            return geoJsonFeatures;
        }

        function renderLink(link, linkAttributions) {
            const geoJsonFeatures = [];
            const geometry = link.platform_geometry;
            if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                const pointsCount = geometry.linestring_points.length;
                const startPoint = geometry.linestring_points[0];
                const endPoint = geometry.linestring_points[pointsCount - 1];

                const withAttributions = isLinkWithAttributions(link, linkAttributions);
                const color = withAttributions ? LINK_WITH_ATTRIBUTIONS_COLOR : LINK_WITHOUT_ATTRIBUTIONS_COLOR;
                const tooltip = buildLinkTooltip(link, withAttributions);

                if (withAttributions) {
                    geoJsonFeatures.pushArray(common.render.renderLineString2dArrows(
                        geometry, color, LINK_LINE_WIDTH, tooltip, LINK_ARROW_OPTIONS));
                } else {
                    // tooltip just for the start point to evict overlapping the tooltips
                    geoJsonFeatures.push(common.render.renderPoint2d(startPoint, LINK_POINT_RADIUS, color, color, tooltip));
                    geoJsonFeatures.push(common.render.renderPoint2d(endPoint, LINK_POINT_RADIUS, color, color));
                    geoJsonFeatures.push(common.render.renderLineString2d(geometry, color, LINK_LINE_WIDTH, tooltip));
                }
            }
            return geoJsonFeatures;
        }

        function isLinkWithAttributions(link, linkAttributions) {
            for (const linkAttribution of linkAttributions) {
                if (linkAttribution.tileId == link.tile_id
                    && linkAttribution.linkRef == link.link_id
                    && linkAttribution.roadLocalAttributions.length > 0) {
                    return true;
                }
            }
            return false;
        }

        function buildLinkTooltip(link, withAttributions) {
            let tooltip = `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>`;
            if (!withAttributions) {
                tooltip += "<b>No infrastructure separation found.</b><br>";
            }
            return tooltip;
        }

        /* -------------------------------------------------
         * Infrastructure Separation rendering.
         * -------------------------------------------------
         */

        function renderLinkAttributions(linkAttributions, links) {
            const geoJsonFeatures = [];
            for (const linkAttribution of linkAttributions) {
                const features = renderLinkAttribution(linkAttribution, links);
                geoJsonFeatures.pushArray(features);
            }
            logger.info("Rendering %d geoJsonFeatures for link attributions.", geoJsonFeatures.length);
            return geoJsonFeatures;
        }

        function renderLinkAttribution(linkAttribution, links) {
            const geoJsonFeatures = [];
            const link = findLink(linkAttribution, links);
            if (link) {
                for (const roadLocalAttribution of linkAttribution.roadLocalAttributions) {
                    const features = renderRoadLocalAttribution(roadLocalAttribution, link);
                    geoJsonFeatures.pushArray(features);
                }
            }
            return geoJsonFeatures;
        }

        function findLink(linkAttribution, links) {
            for (const link of links) {
                if (link.tile_id == linkAttribution.tileId
                    && link.link_id == linkAttribution.linkRef) {
                    return link;
                }
            }
            return null;
        }

        function renderRoadLocalAttribution(roadLocalAttribution, link) {
            const geoJsonFeatures = [];
            const geometry = link.platform_geometry;
            if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                const range = roadLocalAttribution.range;
                const linkLength = common.line2d.calculateLength(geometry);
                const lineStringCut = common.line2d.cut(geometry, [range], linkLength);
                if (lineStringCut.inRange.length > 0) {
                    const attributionLineString = lineStringCut.inRange[0];
                    const bearings = common.line2d.calculateBearings(attributionLineString);
                    const tooltip = buildRoadLocalAttributionTooltip(roadLocalAttribution, link);
                    if (roadLocalAttribution.presentOnSide == INFRA_SEP_LEFT
                            || roadLocalAttribution.presentOnSide == INFRA_SEP_BOTH) {
                        const feature = renderLocalAttributionPolygon(
                            attributionLineString, bearings,
                            common.line2d.Direction.LEFT, tooltip);
                        geoJsonFeatures.push(feature);
                    }
                    if (roadLocalAttribution.presentOnSide == INFRA_SEP_RIGHT
                            || roadLocalAttribution.presentOnSide == INFRA_SEP_BOTH) {
                        const feature = renderLocalAttributionPolygon(
                            attributionLineString, bearings,
                            common.line2d.Direction.RIGHT, tooltip);
                        geoJsonFeatures.push(feature);
                    }
                }
            }
            return geoJsonFeatures;
        }

        function renderLocalAttributionPolygon(attributionLineString, bearings, direction, tooltip) {
            const lineShifted = common.line2d.shift(attributionLineString, direction,
                INFRA_SEP_SHIFT_DISTANCE, bearings);
            const points = attributionLineString.linestring_points.concat(lineShifted.linestring_points.reverse());
            const polygon = { linestring_points: points };
            const borderColor = (direction == common.line2d.Direction.LEFT)
                ? INFRA_SEP_LEFT_BORDER_COLOR
                : INFRA_SEP_RIGHT_BORDER_COLOR;
            const fillColor = (direction == common.line2d.Direction.LEFT)
                ? INFRA_SEP_LEFT_FILL_COLOR
                : INFRA_SEP_RIGHT_FILL_COLOR;
            return common.render.renderLineString2dPolygon(
                polygon, borderColor, fillColor,
                INFRA_SEP_LINE_WIDTH, tooltip);
        }

        function buildRoadLocalAttributionTooltip(roadLocalAttribution, link) {
            const separator = '<hr style="margin: 2px 0 5px 0; border-color: #009E9A">';
            const presentOnSideDesc = common.proto.getEnumName(
                RelativeSideMetadata, roadLocalAttribution.presentOnSide);
            return `<b>Infrastructure Separation</b><br>${separator}` +
                   `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>` +
                   `<b>Present on Side:</b> ${presentOnSideDesc}<br>` +
                   `<b>Parametric Range:</b> ${roadLocalAttribution.range.start} - ${roadLocalAttribution.range.end}<br>`;
        }

        /* -------------------------------------------------
         * Localization barriers rendering.
         * -------------------------------------------------
         */

        function renderLocalizationBarriers(barriers) {
            const geoJsonFeatures = [];
            for (const barrier of barriers) {
                const features = renderBarrier(barrier);
                geoJsonFeatures.pushArray(features);
            }
            logger.info("Rendering %d geoJsonFeatures for localization barriers.", geoJsonFeatures.length);
            return geoJsonFeatures;
        }

        function renderBarrier(barrier) {
            const geoJsonFeatures = [];
            const geometry = barrier.platform_top_geometry;
            if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                const pointsCount = geometry.linestring_points.length;
                const startPoint = geometry.linestring_points[0].lat_lon;
                const endPoint = geometry.linestring_points[pointsCount - 1].lat_lon;
                const tooltip = buildBarrierTooltip(barrier);
                const color = selectNextColor();

                geoJsonFeatures.push(common.render.renderPoint2d(startPoint, BARRIER_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderPoint2d(endPoint, BARRIER_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderLineString3d(geometry, color, BARRIER_LINE_WIDTH, tooltip));
            }
            return geoJsonFeatures;
        }

        function buildBarrierTooltip(barrier) {
            const barrierType = BARRIER_TYPE_ENUM[barrier.type] || "UNKNOWN";
            return `<b>Barrier Id:</b> ${buildBarrierIdTooltip(barrier.barrier_id)} ${buildTileIdTooltip(barrier.tile_id)}<br>` +
                   `<b>Barrier Type:</b> ${barrierType} (${barrier.type})<br>`;
        }

        /* -------------------------------------------------
         * Utility functions
         * -------------------------------------------------
         */

        let colorIndex = 0;

        function selectNextColor() {
            colorIndex = colorIndex + 1;
            if (colorIndex >= BARRIER_FEATURES_COLORS.length) {
                colorIndex = 0;
            }
            return BARRIER_FEATURES_COLORS[colorIndex];
        }

        function buildTileIdTooltip(tileId) {
            return `<span style="color:${TOOLTIP_TILE_ID_COLOR}">[${tileId}]</span>`;
        }

        function buildBarrierIdTooltip(barrierId) {
            return barrierId && barrierId != 0 ? barrierId : "Undefined";
        }

        // Only what we want to expose
        return {
            renderLaneGroups: renderLaneGroups,
            renderLinks: renderLinks,
            renderLinkAttributions: renderLinkAttributions,
            renderLocalizationBarriers: renderLocalizationBarriers
        };
    };


})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.v1.routing.RoutingAttributesLayerTile'] = {} : exports);
