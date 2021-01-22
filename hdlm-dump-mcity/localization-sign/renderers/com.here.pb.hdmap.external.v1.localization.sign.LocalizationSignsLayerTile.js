/**
 * Plugin to convert com.here.pb.hdmap.external.v1.localization.sign.LocalizationSignsLayerTile layers to GeoJSON.
 */
(function (exports) {
    "use strict";

    const COMMON_MODULE = "com.here.pb.hdmap.shared.v1.core.Common";

    const SIGN_SHAPE_ENUM = "com.here.pb.hdmap.external.v1.localization.sign.SignShape";
    const SIGN_COLOR_ENUM = "com.here.pb.hdmap.external.v1.localization.sign.SignColor";
    const SIGN_CLASSIFICATION_ENUM = "com.here.pb.hdmap.external.v1.localization.sign.SignClassificationType";

    // Render configuration output type
    const OUTPUT_TYPE = "application/vnd.geo+json; charset=utf-8";

    // Geometry configuration
    const LINK_LINE_WIDTH = 4;
    const LINK_POINT_RADIUS = 0.8;
    const LINK_WITH_SIGNS_COLOR = "#00CC00"; // light green
    const LINK_WITHOUT_SIGNS_COLOR = "#BBBBBB"; // light grey

    const SIGN_POINT_RADIUS = 4;
    const SIGN_CENTER_POINT_RADIUS = 0.5;
    const SIGN_ALPHA_CHANNEL = "BB";
    const SIGN_WITHOUT_LINKREF = "#BABABA"; // light grey
    const SIGN_FEATURES_COLORS_MAP = new Map([
        ["0", "#CE716F"], // dark pink
        ["1", "#E20AA2"], // pink
        ["2", "#FFFFFF"], // white
        ["3", "#9F0007"], // dark red
        ["4", "#129F03"], // dark green
        ["5", "#0A169F"], // dark blue
        ["6", "#E2D651"], // light ocher
        ["7", "#000000"], // black
        ["8", "#85551D"] // brown
    ]);

    const TOOLTIP_TILE_ID_COLOR = "#DDDDDD";

    /**
     * Converts the decoded tile information to GeoJSON features to render the signs in the map.
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
        const references = data.road_to_signs_references;
        if (!data.signs && !references) {
            logger.info("Source data does not have any features lists. Make sure your are passing correct data to renderer.");
            return null;
        }

        logger.info("Initializing common modules.");
        const common = loadCommonModules(logger, layer, context, mapUtils);

        logger.info("Common modules initialized. Loading layers data.")
        const loader = new LayerLoader(logger, layer, context, common);
        const renderer = new LayerRenderer(logger, context, common);

        const referencedTileIds = loader.getReferencedTileIds(references);
        logger.info("Current context tileId: %s", context.partition);
        logger.info("Referenced tileIds: %s", JSON.stringify(referencedTileIds));

        return loader.loadAllData(referencedTileIds).then(function (features) {
            const signs = features.signs;
            logger.info("Signs loaded: %s", signs.length);
            const links = features.links;
            logger.info("Links loaded: %s", links.length);

            const signsShapeMetadata = features.signsShapeMetadata;
            const signsColorMetadata = features.signsColorMetadata;
            const signsClassificationMetadata = features.signsClassificationMetadata;

            const geoJsonFeatures = []
                .concat(renderer.renderLinks(links, references))
                .concat(renderer.renderLocalizationSigns(signs, references, signsShapeMetadata, signsColorMetadata, signsClassificationMetadata));

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
            const signTileIds = new Set([context.partition]);
            const linkTileIds = new Set([context.partition]);
            for (const reference of references) {
                for (const signRef of reference.sign_refs) {
                    signTileIds.add("" + signRef.sign_here_tile_id);
                }
            }
            return {
                signTileIds: Array.from(signTileIds),
                linkTileIds: Array.from(linkTileIds)
            };
        }

        function loadAllData(tileIds) {
            const signsPromise = loadSigns(tileIds.signTileIds);
            const linksPromise = loadLinks(tileIds.linkTileIds);
            const signsShapeMetadataPromise = loadEnumMetadata(SIGN_SHAPE_ENUM);
            const signsColorMetadataPromise = loadEnumMetadata(SIGN_COLOR_ENUM);
            const signsClassificationMetadataPromise = loadEnumMetadata(SIGN_CLASSIFICATION_ENUM);
            return Promise.all([
                signsPromise,
                linksPromise,
                signsShapeMetadataPromise,
                signsColorMetadataPromise,
                signsClassificationMetadataPromise]).then(function (data) {
                const signs = data[0];
                const links = data[1];
                const signsShapeMetadata = data[2];
                const signsColorMetadata = data[3];
                const signsClassificationMetadata = data[4];
                return {
                    signs: signs,
                    links: links,
                    signsShapeMetadata: signsShapeMetadata,
                    signsColorMetadata: signsColorMetadata,
                    signsClassificationMetadata: signsClassificationMetadata
                };
            });
        }

        function loadSigns(tileIds) {
            return common.loader.loadExternalLocalSignTilesFromContext(tileIds).then(function (tiles) {
                const signs = [];
                for (const tile of tiles) {
                    const tileCenter = {
                        here_2d_coordinate: Long.fromValue(tile.tile_center_here_3d_coordinate.here_2d_coordinate),
                        cm_from_WGS84_ellipsoid: Long.fromValue(tile.tile_center_here_3d_coordinate.cm_from_WGS84_ellipsoid)
                    };
                    for (const sign of tile.signs) {
                        signs.push(Object.assign({
                            tile_id: tile.here_tile_id,
                            tile_center: tileCenter
                        }, sign));
                    }
                }
                return signs;
            });
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

                const roadToSignsReference = findLinkReference(references, link);
                let color = LINK_WITHOUT_SIGNS_COLOR;
                if (roadToSignsReference) {
                    color = LINK_WITH_SIGNS_COLOR;
                }

                const tooltip = buildLinkTooltip(link, roadToSignsReference);

                // tooltip just for the start point to evict overlapping the tooltips
                geoJsonFeatures.push(common.render.renderPoint2d(startPoint, LINK_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderPoint2d(endPoint, LINK_POINT_RADIUS, color, color));
                geoJsonFeatures.push(common.render.renderLineString2d(geometry, color, LINK_LINE_WIDTH, tooltip));
            }
            return geoJsonFeatures;
        }

        function findLinkReference(references, link) {
            for (const roadToSignsReference of references) {
                if (roadToSignsReference.link_ref == link.link_id) {
                    return roadToSignsReference;
                }
            }
            return null;
        }

        function buildLinkTooltip(link, roadToSignsReference) {
            let tooltip = `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>`;
            if (roadToSignsReference) {
                tooltip += "<br>";
                const signRefs = Array.from(roadToSignsReference.sign_refs);
                signRefs.sort(compareTiledSignRefs);
                for (const signRef of signRefs) {
                    tooltip += `<b>Sign Id:</b> ` +
                        `${buildSignIdTooltip(signRef.sign_id)} ` +
                        `${buildTileIdTooltip(signRef.sign_here_tile_id)}<br>`;
                }
            } else {
                tooltip += "<b>No signs reference found.</b><br>";
            }
            return tooltip;
        }

        /* -------------------------------------------------
         * Localization signs rendering.
         * -------------------------------------------------
         */
        function renderLocalizationSigns(signs, references, signsShapeMetadataPromise,
                                         signsColorMetadataPromise, signsClassificationMetadata) {
            const geoJsonFeatures = [];
            for (const sign of signs) {
                const features = renderSign(sign, references, signsShapeMetadataPromise,
                    signsColorMetadataPromise, signsClassificationMetadata);
                geoJsonFeatures.pushArray(features);
            }
            return geoJsonFeatures;
        }

        function renderSign(sign, references, signsShapeMetadataPromise,
                            signsColorMetadataPromise, signsClassificationMetadata) {
            const geoJsonFeatures = [];
            const point3dOffset = {
                here_2d_coordinate: sign.here_2d_coordinate,
                cm_from_WGS84_ellipsoid: sign.cm_from_WGS84_ellipsoid
            };
            const centerPoint = common.conversions.point3dOffsetToPlatform(point3dOffset, sign.tile_center);
            if (centerPoint && centerPoint.lat_lon) {
                const isReferenced = isSignReferencedByLinks(references, sign);
                if (isReferenced || sign.tile_id == context.partition) {
                    const tooltip = buildSignTooltip(sign, centerPoint,
                        signsShapeMetadataPromise, signsColorMetadataPromise, signsClassificationMetadata);
                    let fillColor = SIGN_WITHOUT_LINKREF;
                    if (isReferenced) {
                        fillColor = SIGN_FEATURES_COLORS_MAP.get(sign.dominant_color.toString())
                    }
                    const color = fillColor;
                    fillColor += SIGN_ALPHA_CHANNEL;

                    geoJsonFeatures.push(common.render.renderPoint3d(centerPoint, SIGN_POINT_RADIUS, color, fillColor, tooltip));
                    geoJsonFeatures.push(common.render.renderPoint3d(centerPoint, SIGN_CENTER_POINT_RADIUS, color, color, tooltip));
                }
            }
            return geoJsonFeatures;
        }

        function isSignReferencedByLinks(references, sign) {
            if (sign.sign_id && sign.sign_id != 0) {
                const signId = Long.fromValue(sign.sign_id);
                for (const roadToSignsReference of references) {
                    for (const signRef of roadToSignsReference.sign_refs) {
                        if (signRef.sign_here_tile_id == sign.tile_id
                            && signRef.sign_id && signRef.sign_id != 0
                            && Long.fromValue(signRef.sign_id).equals(signId)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        function buildSignTooltip(sign, centerPoint, signsShapeMetadata,
                                  signsColorMetadata, signsClassificationMetadata) {
            const shape = common.proto.getEnumName(signsShapeMetadata, sign.exterior_shape);
            const color = common.proto.getEnumName(signsColorMetadata, sign.dominant_color);
            const classification = sign.classification;
            const classificationEnum = common.proto.getEnumName(signsClassificationMetadata, classification.type);
            let classificationValue = "";
            if (classification.value != null && classification.value != "") {
                classificationValue = ": " + classification.value
            }
            return `<b>Sign Id:</b> ${buildSignIdTooltip(sign.sign_id)} ${buildTileIdTooltip(sign.tile_id)}<br>` +
                `<b>Classification:</b> ${classificationEnum} ${classificationValue}<br>` +
                `<b>Altitude:</b> ${centerPoint.elevation.cm_from_WGS84_ellipsoid} cm<br>` +
                `<b>Heading:</b> ${sign.heading_degrees} degrees<br>` +
                `<b>Width/Height:</b> ${sign.exterior_width_cm}/${sign.exterior_height_cm} cm<br>` +
                `<b>Exterior Shape:</b> ${shape}<br>` +
                `<b>Dominant Color:</b> ${color}`
                ;
        }

        /* -------------------------------------------------
         * Utility functions
         * -------------------------------------------------
         */
        function buildTileIdTooltip(tileId) {
            return `<span style="color:${TOOLTIP_TILE_ID_COLOR}">[${tileId}]</span>`;
        }

        function buildSignIdTooltip(signId) {
            return signId && signId != 0 ? signId : "Undefined";
        }

        function compareTiledSignRefs(tiledFeature1, tiledFeature2) {
            if (tiledFeature1.sign_here_tile_id < tiledFeature2.sign_here_tile_id) return -1;
            if (tiledFeature1.sign_here_tile_id > tiledFeature2.sign_here_tile_id) return 1;
            if (tiledFeature1.sign_id < tiledFeature2.sign_id) return -1;
            if (tiledFeature1.sign_id > tiledFeature2.sign_id) return 1;
            return 0;
        }

        // Only what we want to expose
        return {
            renderLinks: renderLinks,
            renderLocalizationSigns: renderLocalizationSigns
        };
    };


})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.v1.localization.sign.LocalizationSignsLayerTile'] = {} : exports);
