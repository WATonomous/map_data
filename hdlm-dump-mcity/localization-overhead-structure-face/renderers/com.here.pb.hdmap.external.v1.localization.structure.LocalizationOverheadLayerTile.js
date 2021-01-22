/**
 * Plugin to convert com.here.pb.hdmap.external.v1.localization.structure.LocalizationOverheadLayerTile layers to GeoJSON.
 */
(function (exports) {
    "use strict";

    const COMMON_MODULE = "com.here.pb.hdmap.shared.v1.core.Common";

    // Render configuration output type
    const OUTPUT_TYPE = "application/vnd.geo+json; charset=utf-8";

    // Geometry configuration
    const LINK_WITH_OSFS_LINE_WIDTH = 4;
    const LINK_WITHOUT_OSFS_LINE_WIDTH = 2;
    const LINK_POINT_RADIUS = 0.8;
    const LINK_WITH_OSFS_COLOR = "#00CC00"; // light green
    const LINK_WITHOUT_OSFS_COLOR = "#BABABA"; // light grey

    // OSF configuration
    const OSF_LINE_WIDTH = 4;
    const OSF_WITH_LINKREF_COLOR = "#FA0000"; // red
    const OSF_WITHOUT_LINKREF_COLOR = "#FFFFFF"; // white

    // Common configuration
    const TOOLTIP_TILE_ID_COLOR = "#DDDDDD";


    /**
     * Converts the decoded tile information to GeoJSON features to render the OSFs in the map.
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
        const references = data.road_to_overhead_structure_faces_references;
        if (!data.overhead_structure_faces && !references) {
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
            const osfs = features.osfs;
            logger.info("OSFs loaded: %s", osfs.length);
            const links = features.links;
            logger.info("Links loaded: %s", links.length);

            const geoJsonFeatures = []
                .concat(renderer.renderLinks(links, references))
                .concat(renderer.renderLocalizationOsfs(osfs, references));

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
            const osfTileIds = new Set([context.partition]);
            const linkTileIds = new Set([context.partition]);
            for (const reference of references) {
                for (const osfRef of reference.overhead_structure_face_refs) {
                    osfTileIds.add("" + osfRef.overhead_structure_face_here_tile_id);
                }
            }
            return {
                osfTileIds: Array.from(osfTileIds),
                linkTileIds: Array.from(linkTileIds)
            };
        }

        function loadAllData(tileIds) {
            const osfsPromise = loadOsfs(tileIds.osfTileIds);
            const linksPromise = loadLinks(tileIds.linkTileIds);
            return Promise.all([osfsPromise, linksPromise]).then(function (data) {
                const osfs = data[0];
                const links = data[1];
                return {
                    osfs: osfs,
                    links: links
                };
            });
        }

        function loadOsfs(tileIds) {
            return common.loader.loadExternalLocalOsfTilesFromContext(tileIds).then(function (tiles) {
                const osfs = [];
                for (const tile of tiles) {
                    const tileCenter = {
                        here_2d_coordinate: Long.fromValue(tile.tile_center_here_3d_coordinate.here_2d_coordinate),
                        cm_from_WGS84_ellipsoid: Long.fromValue(tile.tile_center_here_3d_coordinate.cm_from_WGS84_ellipsoid)
                    };
                    for (const osf of tile.overhead_structure_faces) {
                        osfs.push(Object.assign({
                            tile_id: tile.here_tile_id,
                            tile_center: tileCenter
                        }, osf));
                    }
                }
                return osfs;
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

                const roadToOsfsReference = findLinkReference(references, link);
                let lineWidth = LINK_WITHOUT_OSFS_LINE_WIDTH;
                let color = LINK_WITHOUT_OSFS_COLOR;
                if (roadToOsfsReference) {
                    lineWidth = LINK_WITH_OSFS_LINE_WIDTH;
                    color = LINK_WITH_OSFS_COLOR;
                }

                const tooltip = buildLinkTooltip(link, roadToOsfsReference);

                // tooltip just for the start point to evict overlapping the tooltips
                geoJsonFeatures.push(common.render.renderPoint2d(startPoint, LINK_POINT_RADIUS, color, color, tooltip));
                geoJsonFeatures.push(common.render.renderPoint2d(endPoint, LINK_POINT_RADIUS, color, color));
                geoJsonFeatures.push(common.render.renderLineString2d(geometry, color, lineWidth, tooltip));
            }
            return geoJsonFeatures;
        }

        function findLinkReference(references, link) {
            for (const roadToOsfsReference of references) {
                if (roadToOsfsReference.link_ref == link.link_id) {
                    return roadToOsfsReference;
                }
            }
            return null;
        }

        function buildLinkTooltip(link, roadToOsfsReference) {
            let tooltip = `<b>Link Id:</b> ${link.link_id} ${buildTileIdTooltip(link.tile_id)}<br>`;
            if (roadToOsfsReference) {
                const osfRefs = Array.from(roadToOsfsReference.overhead_structure_face_refs);
                osfRefs.sort(compareTiledOsfRefs);
                for (const osfRef of osfRefs) {
                    tooltip += `<b>Overhead Structure Face Id:</b> ` +
                        `${buildOsfIdTooltip(osfRef.overhead_structure_face_id)} ` +
                        `${buildTileIdTooltip(osfRef.overhead_structure_face_here_tile_id)}<br>`;
                }
            } else {
                tooltip += "<b>No Overhead Structure Face reference found.</b><br>";
            }
            return tooltip;
        }

        /* -------------------------------------------------
         * Localization OSFs rendering.
         * -------------------------------------------------
         */
        function renderLocalizationOsfs(osfs, references) {
            const geoJsonFeatures = [];
            for (const osf of osfs) {
                const features = renderOsf(osf, references);
                geoJsonFeatures.pushArray(features);
            }
            return geoJsonFeatures;
        }

        function renderOsf(osf, references) {
            const geoJsonFeatures = [];
            if (osf.vertical_surface && osf.vertical_surface.bottom) {
                const geometry = common.conversions.lineString3dOffsetToPlatform(osf.vertical_surface.bottom, osf.tile_center);
                if (geometry && geometry.linestring_points && geometry.linestring_points.length > 1) {
                    const isReferenced = isOsfReferencedByLinks(references, osf);
                    if (isReferenced || osf.tile_id == context.partition) {
                        const tooltip = buildOsfTooltip(osf);
                        let color = OSF_WITHOUT_LINKREF_COLOR;
                        if (isReferenced) {
                            color = OSF_WITH_LINKREF_COLOR;
                        }
                        geoJsonFeatures.push(common.render.renderLineString3d(geometry, color, OSF_LINE_WIDTH, tooltip));
                    }
                }
            }
            return geoJsonFeatures;
        }

        function isOsfReferencedByLinks(references, osf) {
            if (osf.id && osf.id != 0) {
                const osfId = Long.fromValue(osf.id);
                for (const roadToOsfsReference of references) {
                    for (const osfRef of roadToOsfsReference.overhead_structure_face_refs) {
                        if (osfRef.overhead_structure_face_here_tile_id == osf.tile_id
                            && osfRef.overhead_structure_face_id
                            && osfRef.overhead_structure_face_id != 0
                            && Long.fromValue(osfRef.overhead_structure_face_id).equals(osfId)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        function buildOsfTooltip(osf) {
            return `<b>Overhead Structure Face Id:</b> ${buildOsfIdTooltip(osf.id)} ${buildTileIdTooltip(osf.tile_id)}<br>`;
        }

        /* -------------------------------------------------
         * Utility functions
         * -------------------------------------------------
         */
        function buildTileIdTooltip(tileId) {
            return `<span style="color:${TOOLTIP_TILE_ID_COLOR}">[${tileId}]</span>`;
        }

        function buildOsfIdTooltip(osfId) {
            return osfId && osfId != 0 ? osfId : "Undefined";
        }

        function compareTiledOsfRefs(tiledFeature1, tiledFeature2) {
            if (tiledFeature1.overhead_structure_face_here_tile_id < tiledFeature2.overhead_structure_face_here_tile_id) return -1;
            if (tiledFeature1.overhead_structure_face_here_tile_id > tiledFeature2.overhead_structure_face_here_tile_id) return 1;
            if (tiledFeature1.overhead_structure_face_id < tiledFeature2.overhead_structure_face_id) return -1;
            if (tiledFeature1.overhead_structure_face_id > tiledFeature2.overhead_structure_face_id) return 1;
            return 0;
        }

        // Only what we want to expose
        return {
            renderLinks: renderLinks,
            renderLocalizationOsfs: renderLocalizationOsfs
        };
    };


})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.v1.localization.structure.LocalizationOverheadLayerTile'] = {} : exports);
