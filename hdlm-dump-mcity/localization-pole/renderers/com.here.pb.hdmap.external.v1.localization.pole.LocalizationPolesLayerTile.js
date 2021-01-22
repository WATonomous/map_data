/**
 * Plugin to convert com.here.pb.hdmap.external.v1.localization.pole.LocalizationPoleTile layers to GeoJSON.
 */
(function (exports) {
    "use strict";

    const COMMON_MODULE = "com.here.pb.hdmap.shared.v1.core.Common";
    const POLE_TYPE_ENUM = "com.here.pb.hdmap.external.v1.localization.pole.PoleType";
    // Render configuration output type
    const OUTPUT_TYPE = "application/vnd.geo+json; charset=utf-8";

    // Geometry configuration
    const POLE_POINT_RADIUS = 1.0;
    const POLE_ALPHA_CHANNEL = "CC";
    const POLE_WITHOUT_LINKREF = "#BABABA"; // light grey
    const POLE_PALETTE_COLOR = [
        "#4F6BFF", // blue
        "#DDD753", // yellow,
        "#FA4348", // red
        "#6DFA65", // green
        "#A37F4F", // brown
        "#A077C2", // purple
        "#C28B05", // orange
        "#99FFFF" // cyan
    ];

    const LINK_LINE_WIDTH = 4;
    const LINK_POINT_RADIUS = 0.8;
    const LINK_WITH_POLES_COLOR = "#00CC00"; // light green
    const LINK_WITHOUT_POLES_COLOR = "#BBBBBB"; // light grey

    const TOOLTIP_TILE_ID_COLOR = "#DDDDDD";

    /**
     * Converts the decoded tile information to GeoJSON features to render the poles in the map.
     *
     * This function is called automatically by the datastore inspector plugin.
     *
     * @param logger the datastore inspector plugin logger
     * @param layer the current catalog layer metadata
     * @param decodeResult the decoded data of the tile
     * @param context the datastore inspector plugin context
     *
     * @returns a promise with the GeoJSON features data to render
     */
    exports.promiseToGeoJSON = function (logger, layer, decodeResult, context, mapUtils) {
        const data = decodeResult.decoded;
        const references = data.road_to_poles_references;

        if (!data.poles && !references) {
            logger.info("Source data does not have any features lists. Make sure you are passing correct data to renderer.");
            return null;
        }

        logger.info("Initializing common modules.");
        const common = loadCommonModules(logger, layer, context, mapUtils);

        logger.info("Common modules initialized. Loading layers data.");
        const loader = new LayerLoader(logger, layer, context, common);
        const renderer = new LayerRenderer(logger, context, common);

        const referencedTileIds = loader.getReferencedTileIds(references);
        logger.info("Current context tileId: %s", context.partition);
        logger.info("Referenced tileIds: %s", JSON.stringify(referencedTileIds));

        return loader.loadAllData(referencedTileIds).then(function (features) {
            const poles = features.poles;
            logger.info("Poles loaded: %s", poles.length);
            const links = features.links;
            logger.info("Links loaded: %s", links.length);
            const polesTypeMetadata = features.polesTypeMetadata;

            const geoJsonFeatures = []
                .concat(renderer.renderLinks(links, references))
                .concat(renderer.renderLocalizationPoles(poles, references, polesTypeMetadata));

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

    };

    /* -------------------------------------------------
     * Loading of module dependencies.
     * -------------------------------------------------
     */

    /*
     * Loads the common modules.
     *
     * @param logger
     *              the datastore inspector plugin logger
     * @param layer
     *              the current catalog layer metadata
     * @param context
     *              the datastore inspector plugin context
     *
     * @returns an object with the common modules
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
    }


    /* -------------------------------------------------
     * Functions for the setup and load of the involved tiles.
     * -------------------------------------------------
     */

    const LayerLoader = function (logger, layer, context, common) {

        const Long = common.mapUtils.requireLong();

        function getReferencedTileIds(references) {
            const poleTileIds = new Set([context.partition]);
            const linkTileIds = new Set([context.partition]);
            for (const reference of references) {
                for (const ref of reference.pole_refs) {
                    poleTileIds.add(ref.pole_here_tile_id);
                }
            }
            return {
                poleTileIds: Array.from(poleTileIds),
                linkTileIds: Array.from(linkTileIds)
            };
        }

        function loadAllData(tileIds) {
            const polesPromise = loadPoles(tileIds.poleTileIds);
            const linksPromise = loadLinks(tileIds.linkTileIds);
            const polesTypeMetadata = loadEnumMetadata(POLE_TYPE_ENUM);
            return Promise.all([polesPromise, linksPromise, polesTypeMetadata])
                .then(function (data) {
                    const poles = data[0];
                    const links = data[1];
                    const polesTypeMetadata = data[2];
                    return {
                        poles: poles,
                        links: links,
                        polesTypeMetadata: polesTypeMetadata
                    };
                });
        }

        function loadPoles(tileIds) {
            return common.loader.loadExternalLocalPoleTilesFromContext(tileIds).then(function (tiles) {
                const poles = [];
                for (const tile of tiles) {
                    const tileCenter = {
                        here_2d_coordinate: Long.fromValue(tile.tile_center_here_3d_coordinate.here_2d_coordinate),
                        cm_from_WGS84_ellipsoid: Long.fromValue(tile.tile_center_here_3d_coordinate.cm_from_WGS84_ellipsoid)
                    };
                    if (tile.poles) {
                        for (const pole of tile.poles) {
                            poles.push(Object.assign({
                                tile_id: tile.here_tile_id,
                                tile_center: tileCenter
                            }, pole))
                        }
                    }
                }
                return poles;
            })
        }

        function loadLinks(tileIds) {
            return common.loader.loadExternalTopologyGeometryTilesFromContext(tileIds).then(function (tiles) {
                const links = [];
                for (const tile of tiles) {
                    const tileCenter = Long.fromValue(tile.tile_center_here_2d_coordinate);
                    for (const link of tile.links_starting_in_tile) {
                        links.push(Object.assign({
                            tile_id: tile.here_tile_id,
                            tile_center: tileCenter
                        }, link));
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
    const LayerRenderer = function (logger, context, common) {

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

                const roadToPolesReference = findLinkReference(references, link);
                let color = LINK_WITHOUT_POLES_COLOR;
                if (roadToPolesReference) {
                    color = LINK_WITH_POLES_COLOR;
                }

                const tooltip = buildLinkTooltip(link, roadToPolesReference);

                // tooltip just for the start point to evict overlapping the tooltips
                geoJsonFeatures.push(common.render.renderPoint2d(startPoint, LINK_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderPoint2d(endPoint, LINK_POINT_RADIUS, color, color));
                geoJsonFeatures.push(common.render.renderLineString2d(geometry, color, LINK_LINE_WIDTH, tooltip));
            }
            return geoJsonFeatures;
        }

        function findLinkReference(references, link) {
            for (const reference of references) {
                if (reference.link_ref == link.link_id) {
                    return reference;
                }
            }
            return null;
        }

        function buildLinkTooltip(link, roadToPolesReference) {
            let tooltip = `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>`;
            if (roadToPolesReference) {
                tooltip += "<br>";
                const refs = Array.from(roadToPolesReference.pole_refs);
                refs.sort(comparePoleRef);
                for (const ref of refs) {
                    tooltip += `<b>Pole Id:</b> ` +
                        `${buildPoleIdTooltip(ref.pole_id)} ` +
                        `${buildTileIdTooltip(ref.pole_here_tile_id)}<br>`;
                }
            } else {
                tooltip += "<b>No poles reference found.</b><br>";
            }
            return tooltip;
        }

        /* -------------------------------------------------
         * Localization poles rendering.
         * -------------------------------------------------
         */
        function renderLocalizationPoles(poles, references, polesTypeMetadata) {
            const geoJsonFeatures = [];
            let colorIndex = 0;
            for (const pole of poles) {
                const features = renderPole(colorIndex, pole, references, polesTypeMetadata);
                colorIndex++;
                if (colorIndex >= POLE_PALETTE_COLOR.length) {
                    colorIndex = 0;
                }
                geoJsonFeatures.pushArray(features);
            }
            return geoJsonFeatures;
        }

        function renderPole(colorIndex, pole, references, polesTypeMetadata) {
            const geoJsonFeatures = [];
            const point3dOffset = {
                here_2d_coordinate: pole.bottom_center_point.here_2d_coordinate,
                cm_from_WGS84_ellipsoid: pole.bottom_center_point.cm_from_WGS84_ellipsoid
            };
            const bottomCenterPoint = common.conversions.point3dOffsetToPlatform(point3dOffset, pole.tile_center);
            if (bottomCenterPoint) {
                const isReferenced = isPoleReferencedByLinks(references, pole);
                if (isReferenced || pole.tile_id == context.partition) {
                    const tooltip = buildPoleTooltip(pole, bottomCenterPoint,  polesTypeMetadata);
                    let fillColor = POLE_WITHOUT_LINKREF;
                    if (isReferenced) {
                        fillColor = POLE_PALETTE_COLOR[colorIndex];
                    }
                    const color = fillColor;
                    fillColor += POLE_ALPHA_CHANNEL;

                    geoJsonFeatures.push(common.render.renderPoint3d(bottomCenterPoint, POLE_POINT_RADIUS, color, fillColor, tooltip));

                }
            }
            return geoJsonFeatures;
        }

        function isPoleReferencedByLinks(references, pole) {
            if (pole.id && pole.id != 0) {
               const poleId = Long.fromValue(pole.id);
               for (const roadToPolesReference of references) {
                   for (const poleRef of roadToPolesReference.pole_refs) {
                       if (poleRef.pole_here_tile_id == pole.tile_id
                       && poleRef.pole_id && poleRef.pole_id != 0
                       && Long.fromValue(poleRef.pole_id).equals(poleId)) {
                           return true;
                       }
                   }
               }
            }
            return false;
        }

        function buildPoleTooltip(pole, bottomCenterPoint, polesTypeMetadata) {
            const bottomDiameterCm = pole.bottom_diameter_cm;
            const poleType = common.proto.getEnumName(polesTypeMetadata, pole.type);

            return `<b>Pole Id: </b> ${buildPoleIdTooltip(pole.id)}  ${buildTileIdTooltip(pole.tile_id)}<br>` +
                `<b>Bottom Diameter cm: </b> ${bottomDiameterCm} <br>` +
                `<b>Bottom Center Point: </b><br>` +
                `&nbsp&nbsp&nbspLatitude: ${bottomCenterPoint.lat_lon.latitude_degrees}<br>` +
                `&nbsp&nbsp&nbspLongitude: ${bottomCenterPoint.lat_lon.longitude_degrees}<br>` +
                `&nbsp&nbsp&nbspElevation cm: ${bottomCenterPoint.elevation.cm_from_WGS84_ellipsoid}<br>` +
                `<b>Pole Type: </b> ${poleType}`
                ;
        }

        /* -------------------------------------------------
         * Utility functions
         * -------------------------------------------------
         */
        function buildTileIdTooltip(tileId) {
            return `<span style="color:${TOOLTIP_TILE_ID_COLOR}">[${tileId}]</span>`;
        }

        function buildPoleIdTooltip(poleId) {
            return poleId && poleId != 0 ? poleId : "Undefined";
        }

        function comparePoleRef(ref1, ref2) {
            if (ref1.pole_here_tile_id < ref2.pole_here_tile_id) return -1;
            if (ref1.pole_here_tile_id > ref2.pole_here_tile_id) return 1;
            if (ref1.pole_id < ref2.pole_id) return -1;
            if (ref1.pole_id > ref2.pole_id) return 1;
            return 0;
        }


        // Only what we want to expose
        return {
            renderLinks: renderLinks,
            renderLocalizationPoles: renderLocalizationPoles
        };
    };

})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.v1.localization.pole.LocalizationPolesLayerTile'] = {} : exports);