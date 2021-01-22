/**
 * Plugin to convert com.here.pb.hdmap.external.v1.localization.barrier.LocalizationBarriersLayerTile layers to GeoJSON.
 */
(function (exports) {
    "use strict";

    const COMMON_MODULE = "com.here.pb.hdmap.shared.v1.core.Common";

    const BARRIER_TYPE_ENUM = "com.here.pb.hdmap.external.v1.localization.barrier.BarrierType";

    // Render configuration output type
    const OUTPUT_TYPE = "application/vnd.geo+json; charset=utf-8";

    // Geometry configuration
    const LINK_LINE_WIDTH = 4;
    const LINK_POINT_RADIUS = 0.8;
    const LINK_WITH_BARRIERS_COLOR = "#00CC00"; // light green
    const LINK_WITHOUT_BARRIERS_COLOR = "#BBBBBB"; // light grey

    const BARRIER_LINE_WIDTH = 3;
    const BARRIER_POINT_RADIUS = 0.5;
    const BARRIER_ALPHA_CHANNEL = "BB";
    const BARRIER_WITHOUT_LINKREF = "#DDDDDD" + BARRIER_ALPHA_CHANNEL; // light grey
    const BARRIER_FEATURES_COLORS = [
        "#42D4F4" + BARRIER_ALPHA_CHANNEL, // cyan
        "#FF000D" + BARRIER_ALPHA_CHANNEL, // dark red
        "#FF0A16" + BARRIER_ALPHA_CHANNEL, // crimson red
        "#FFA114" + BARRIER_ALPHA_CHANNEL, // light ocher
        "#EB00A4" + BARRIER_ALPHA_CHANNEL, // pink
        "#000EA8" + BARRIER_ALPHA_CHANNEL  // dark blue
    ];

    const TOOLTIP_TILE_ID_COLOR = "#DDDDDD";

    /**
     * Converts the decoded tile information to GeoJSON features to render the barriers in the map.
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
     * @param mapUtils
     *              the datastore inspector plugin MapUtils module
     *
     * @returns a promise with the GeoJSON features data to render
     */
    exports.promiseToGeoJSON = function (logger, layer, decodeResult, context, mapUtils) {
        const data = decodeResult.decoded;
        const references = data.road_to_barriers_references;
        if (!data.barriers && !references) {
            logger.info("Source data does not have any features lists. Make sure your are passing correct data to renderer.");
            return null;
        }

        logger.info("Initializing common modules.");
        const common = loadCommonModules(logger, layer, context, mapUtils);

        logger.info("Common modules initialized. Loading layers data.")
        const loader = new LayerLoader(logger, layer, context, common);

        const referencedTileIds = loader.getReferencedTileIds(references);
        logger.info("Current context tileId: %s", context.partition);
        logger.info("Referenced tileIds: %s", JSON.stringify(referencedTileIds));

        return loader.loadAllData(referencedTileIds).then(function (features) {
            const barrierTypeMetadata = features.barrierTypeMetadata;
            const barriers = features.barriers;
            logger.info("Barriers loaded: %s", barriers.length);
            const links = features.links;
            logger.info("Links loaded: %s", links.length);

            const renderer = new LayerRenderer(logger, context, common, barrierTypeMetadata);
            const geoJsonFeatures = []
                .concat(renderer.renderLinks(links, references))
                .concat(renderer.renderLocalizationBarriers(barriers, references));

            logger.info("Rendering geoJsonFeatures: %d", geoJsonFeatures.length);
            return {
                contentType: OUTPUT_TYPE,
                body: {
                    type: "FeatureCollection",
                    features: geoJsonFeatures
                }
            };
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
                comparisonTolerance: Number.EPSILON,
                roundDecimalFactor: 1e12
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

        function getReferencedTileIds(references) {
            const barrierTileIds = new Set([context.partition]);
            const linkTileIds = new Set([context.partition]);
            for (const reference of references) {
                for (const barrierRef of reference.barrier_refs) {
                    barrierTileIds.add("" + barrierRef.barrier_here_tile_id);
                }
            }
            return {
                barrierTileIds: Array.from(barrierTileIds),
                linkTileIds: Array.from(linkTileIds)
            };
        }

        function loadAllData(tileIds) {
            const barriersPromise = loadBarriers(tileIds.barrierTileIds);
            const linksPromise = loadLinks(tileIds.linkTileIds);
            const barrierTypeMetadataPromise = loadEnumMetadata(BARRIER_TYPE_ENUM);
            return Promise.all([barriersPromise, linksPromise, barrierTypeMetadataPromise]).then(function (data) {
                const barriers = data[0];
                const links = data[1];
                const barrierTypeMetadata = data[2];
                return {
                    barriers: barriers,
                    links: links,
                    barrierTypeMetadata: barrierTypeMetadata
                };
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
                            barriers.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                tile_center: tileCenter
                            }, barrier));
                        }
                    }
                }
                return barriers;
            });
        }

        function loadLinks(tileIds) {
            return common.loader.loadExternalTopologyGeometryTilesFromContext(tileIds).then(function (tiles) {
                const links = [];
                for (const tile of tiles) {
                    if (tile.links_starting_in_tile) {
                        const tileCenter = Long.fromValue(tile.tile_center_here_2d_coordinate);
                        for (const link of tile.links_starting_in_tile) {
                            links.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                tile_center: tileCenter
                            }, link));
                        }
                    }
                }
                return links;
            });
        }

        function loadEnumMetadata(enumType) {
            return layer.protobufManager.getProtoBuilder(layer.manifest).then(function (protobuf) {
                return common.proto.findMetadata(protobuf, enumType);
            });
        }

        // Only what we want to expose
        return {
            getReferencedTileIds: getReferencedTileIds,
            loadAllData: loadAllData
        };
    };


    /* -------------------------------------------------
     * Functions for rendering.
     * -------------------------------------------------
     */

    const LayerRenderer = function (logger, context, common, barrierTypeMetadata) {

        const Long = common.mapUtils.requireLong();

        /* -------------------------------------------------
         * Road links rendering.
         * -------------------------------------------------
         */

        function renderLinks(links, references) {
            const geoJsonFeatures = [];
            for (const link of links) {
                const features = renderLink(link, references);
                geoJsonFeatures.pushArray(features);
            }
            return geoJsonFeatures;
        }

        function renderLink(link, references) {
            const geoJsonFeatures = [];
            const geometry = common.conversions.lineString2dOffsetToPlatform(link.geometry, link.tile_center);
            if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                const pointsCount = geometry.linestring_points.length;
                const startPoint = geometry.linestring_points[0];
                const endPoint = geometry.linestring_points[pointsCount - 1];

                const roadToBarriersReference = findLinkReference(references, link);
                let color = LINK_WITHOUT_BARRIERS_COLOR;
                if (roadToBarriersReference) {
                    color = LINK_WITH_BARRIERS_COLOR;
                }

                const tooltip = buildLinkTooltip(link, roadToBarriersReference);

                // tooltip just for the start point to evict overlapping the tooltips
                geoJsonFeatures.push(common.render.renderPoint2d(startPoint, LINK_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderPoint2d(endPoint, LINK_POINT_RADIUS, color, color));
                geoJsonFeatures.push(common.render.renderLineString2d(geometry, color, LINK_LINE_WIDTH, tooltip));
            }
            return geoJsonFeatures;
        }

        function findLinkReference(references, link) {
            for (const roadToBarriersReference of references) {
                if (roadToBarriersReference.link_ref == link.link_id) {
                    return roadToBarriersReference;
                }
            }
            return null;
        }

        function buildLinkTooltip(link, roadToBarriersReference) {
            let tooltip = `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>`;
            if (roadToBarriersReference) {
                tooltip += "<br>";
                const barrierRefs = Array.from(roadToBarriersReference.barrier_refs);
                barrierRefs.sort(compareTiledBarrierRefs);
                for (const barrierRef of barrierRefs) {
                    tooltip += `<b>Barrier Id:</b> ` +
                        `${buildBarrierIdTooltip(barrierRef.barrier_id)} ` +
                        `${buildTileIdTooltip(barrierRef.barrier_here_tile_id)}<br>`;
                }
            } else {
                tooltip += "<b>No barriers reference found.</b><br>";
            }
            return tooltip;
        }

        /* -------------------------------------------------
         * Localization barriers rendering.
         * -------------------------------------------------
         */

        function renderLocalizationBarriers(barriers, references) {
            const geoJsonFeatures = [];
            for (const barrier of barriers) {
                const features = renderBarrier(barrier, references);
                geoJsonFeatures.pushArray(features);
            }
            return geoJsonFeatures;
        }

        function renderBarrier(barrier, references) {
            const geoJsonFeatures = [];
            const geometry = common.conversions.lineString3dOffsetToPlatform(barrier.top_geometry, barrier.tile_center);
            if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                const isReferenced = isBarrierReferencedByLinks(references, barrier);
                if (isReferenced || barrier.tile_id == context.partition) {
                    const pointsCount = geometry.linestring_points.length;
                    const startPoint = geometry.linestring_points[0].lat_lon;
                    const endPoint = geometry.linestring_points[pointsCount - 1].lat_lon;
                    const tooltip = buildBarrierTooltip(barrier);
                    let color = BARRIER_WITHOUT_LINKREF;
                    if (isReferenced) {
                        color = selectNextColor();
                    }

                    geoJsonFeatures.push(common.render.renderPoint2d(startPoint, BARRIER_POINT_RADIUS, color, color, tooltip));
                    geoJsonFeatures.push(common.render.renderPoint2d(endPoint, BARRIER_POINT_RADIUS, color, color, tooltip));
                    geoJsonFeatures.push(common.render.renderLineString3d(geometry, color, BARRIER_LINE_WIDTH, tooltip));
                }
            }
            return geoJsonFeatures;
        }

        function isBarrierReferencedByLinks(references, barrier) {
            if (barrier.barrier_id && barrier.barrier_id != 0) {
                const barrierId = Long.fromValue(barrier.barrier_id);
                for (const roadToBarriersReference of references) {
                    for (const barrierRef of roadToBarriersReference.barrier_refs) {
                        if (barrierRef.barrier_here_tile_id == barrier.tile_id
                            && barrierRef.barrier_id && barrierRef.barrier_id != 0
                            && Long.fromValue(barrierRef.barrier_id).equals(barrierId)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        function buildBarrierTooltip(barrier) {
            const barrierType = common.proto.getEnumName(barrierTypeMetadata, barrier.type);
            return `<b>Barrier Id:</b> ${buildBarrierIdTooltip(barrier.barrier_id)} ${buildTileIdTooltip(barrier.tile_id)}<br>` +
                   `<b>Barrier Type:</b> ${barrierType}<br>`;
        }

        /* -------------------------------------------------
         * Utility functions
         * -------------------------------------------------
         */

        var colorIndex = 0;

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

        function compareTiledBarrierRefs(tiledFeature1, tiledFeature2) {
            if (tiledFeature1.barrier_here_tile_id < tiledFeature2.barrier_here_tile_id) return -1;
            if (tiledFeature1.barrier_here_tile_id > tiledFeature2.barrier_here_tile_id) return 1;
            if (tiledFeature1.barrier_id < tiledFeature2.barrier_id) return -1;
            if (tiledFeature1.barrier_id > tiledFeature2.barrier_id) return 1;
            return 0;
        }

        // Only what we want to expose
        return {
            renderLinks: renderLinks,
            renderLocalizationBarriers: renderLocalizationBarriers
        };
    };


})(typeof exports === 'undefined' ? this['com.here.hdlm.p4.platform.schema.v1.barrier.LocalizationBarrierTile'] = {} : exports);
