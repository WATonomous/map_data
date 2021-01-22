/**
 * Plugin to provide utility functions for renderers. To include use:
 * context.catApi.getPlugin(context.config, context.version, layer, "com.here.pb.hdmap.shared.v1.core.Common")
 * where context and layer are the standard parameters send by DSI to
 * rendering functions like promiseToGeoJSON or toGeoJSON.
 */
(function(exports) {
    "use strict";

    /*
     * Loads all the modules in this file. To use a single module,
     * create a new instance of the module and its dependencies.
     */
    exports.loadAll = function (logger, mapUtils, props) {
        const mathUtils = new exports.MathUtils(logger, props ? props.mathUtils : {});
        const range = new exports.Range(logger);
        const geo = new exports.Geo(logger, mathUtils);
        const line2d = new exports.Line2d(logger, geo);
        const render = new exports.Render(logger, geo, line2d, mapUtils);
        const conversions = new exports.Conversions(logger, mathUtils, line2d, mapUtils);
        const proto = new exports.Proto(logger);
        const loader = new exports.Loader(logger, props.context);
        return {
            mapUtils: mapUtils,
            mathUtils: mathUtils,
            range: range,
            geo: geo,
            line2d: line2d,
            render: render,
            conversions: conversions,
            proto: proto,
            loader: loader
        };
    };


    /* -------------------------------------------------
     * Conversion function from external geometries to platform
     * geometries.
     * -------------------------------------------------
     */

    exports.Conversions = function (logger, mathUtils, line2d, mapUtils) {

        logger.info("Initializing Conversions module.");

        /*
         * Converts an array of com.here.pb.hdmap.external.v1.topology.Link
         * to an array of custom link objects with the geometry converted
         * from com.here.pb.hdmap.external.v1.geometry.LineString2dOffset
         * to com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const linksToPlatform = function (partition, links, tileCenter) {
            const platformLinks = [];
            if (links && links.length > 0) {
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    const platformLink = linkToPlatform(partition, link, tileCenter);
                    platformLinks.push(platformLink);
                }
            }
            return platformLinks;
        };

        /*
         * Converts a single com.here.pb.hdmap.external.v1.topology.Link
         * to a custom link object with the geometry converted
         * from com.here.pb.hdmap.external.v1.geometry.LineString2dOffset
         * to com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const linkToPlatform = function (partition, link, tileCenter) {
            return {
                id: link.link_id,
                partition: partition,
                geometry: lineString2dOffsetToPlatform(link.geometry, tileCenter),
                length: link.link_length_meters
            }
        };

        /*
         * Converts an array of com.here.pb.hdmap.external.alpha.roadbook.DrivablePath
         * to an array of custom drivable path objects with the geometry converted
         * from com.here.pb.hdmap.external.v1.geometry.LineString2dOffset
         * to com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const drivablePathsToPlatform = function (partition, drivablePaths, tileCenter) {
            const platformDrivablePaths = [];
            if (drivablePaths && drivablePaths.length > 0) {
                for (let i = 0; i < drivablePaths.length; i++) {
                    const drivablePath = drivablePaths[i];
                    const platformDrivablePath = drivablePathToPlatform(partition, drivablePath, tileCenter);
                    platformDrivablePaths.push(platformDrivablePath);
                }
            }
            return platformDrivablePaths;
        };

        /*
         * Converts a single com.here.pb.hdmap.external.alpha.roadbook.DrivablePath
         * to a custom drivable path object with the geometry converted
         * from com.here.pb.hdmap.external.v1.geometry.LineString2dOffset
         * to com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const drivablePathToPlatform = function (partition, drivablePath, tileCenter) {
            const lineString2d = lineString2dOffsetToPlatform(drivablePath.geometry, tileCenter);
            return {
                id: drivablePath.id,
                partition: partition,
                geometry: lineString2d,
                length: line2d.calculateLength(lineString2d)
            };
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.geometry.LineString2dOffset to a
         * com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const lineString2dOffsetToPlatform = function (lineString2dOffset, tileCenter) {
            const coordinateDiffs = lineString2dOffset.here_2d_coordinate_diffs || [];
            const levelIndices = lineString2dOffset.z_level_indexes || [];
            const points = [];
            let lastDiff = tileCenter;
            for (let i = 0; i < coordinateDiffs.length; i++) {
                const diff = coordinateDiffs[i];
                const here2dCoordinate = lastDiff.xor(diff);
                const lonLat = mapUtils.hdmapCoordinateToLonLat(here2dCoordinate);
                const levelIndex = (i < levelIndices.length) ? levelIndices[i] : 0;
                const point2d = {
                    latitude_degrees: lonLat[1],
                    longitude_degrees: lonLat[0],
                    z_level_index: {
                        index: levelIndex
                    }
                };
                points.push(point2d);
                lastDiff = here2dCoordinate;
            }
            return {
                linestring_points: points
            };
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.geometry.LineString3dOffset to a
         * com.here.pb.hdmap.platform.v1.geometry.LineString3d
         */
        const lineString3dOffsetToPlatform = function (lineString3dOffset, tileCenter3d) {
            const coordinateDiffs = lineString3dOffset.here_2d_coordinate_diffs || [];
            const cmFromWGS84Diffs = lineString3dOffset.cm_from_WGS84_ellipsoid_diffs || [];
            const points = [];
            let lastCoordinateDiff = tileCenter3d.here_2d_coordinate;
            let lastCmFromWGS84Diff = tileCenter3d.cm_from_WGS84_ellipsoid;
            for (let i = 0; i < coordinateDiffs.length; i++) {
                const coordinateDiff = coordinateDiffs[i];
                const here2dCoordinate = lastCoordinateDiff.xor(coordinateDiff);
                const lonLat = mapUtils.hdmapCoordinateToLonLat(here2dCoordinate);
                const cmFromWGS84Diff = (i < cmFromWGS84Diffs.length) ? cmFromWGS84Diffs[i] : 0;
                const cmFromWGS84 = lastCmFromWGS84Diff.xor(cmFromWGS84Diff);
                const point3d = {
                    lat_lon: {
                        latitude_degrees: lonLat[1],
                        longitude_degrees: lonLat[0],
                        z_level_index: {
                            index: 0
                        }
                    },
                    elevation: {
                        cm_from_WGS84_ellipsoid: cmFromWGS84
                    }
                };
                points.push(point3d);
                lastCoordinateDiff = here2dCoordinate;
                lastCmFromWGS84Diff = cmFromWGS84;
            }
            return {
                linestring_points: points
            };
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.geometry.Point3d (external) to a
         * com.here.pb.hdmap.platform.v1.geometry.Point3d (platform)
         */
        const point3dOffsetToPlatform = function (point3dOffset, tileCenter3d) {
            const coordinateDiff = point3dOffset.here_2d_coordinate || 0;
            const cmFromWGS84Diff = point3dOffset.cm_from_WGS84_ellipsoid || 0;
            const here2dCoordinate = tileCenter3d.here_2d_coordinate.xor(coordinateDiff);
            const lonLat = mapUtils.hdmapCoordinateToLonLat(here2dCoordinate);
            const cmFromWGS84 = tileCenter3d.cm_from_WGS84_ellipsoid.xor(cmFromWGS84Diff);
            return {
                lat_lon: {
                    latitude_degrees: lonLat[1],
                    longitude_degrees: lonLat[0],
                    z_level_index: {
                        index: 0
                    }
                },
                elevation: {
                    cm_from_WGS84_ellipsoid: cmFromWGS84
                }
            };
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.common.ParametricRange to
         * a custom range object with start and end values.
         */
        const parametricRangeToRange = function (parametricRange) {
            const fromStart = parametricRange.range_offset_from_start || 0;
            const fromEnd = parametricRange.range_offset_from_end || 0;
            return {
                start: mathUtils.round(fromStart),
                end: mathUtils.round(1 - fromEnd)
            };
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.common.TiledLinkReference to
         * a custom feature reference object with a partition and id field.
         */
        const tiledLinkReferenceToFeatureRef = function (tiledLinkReference) {
            return {
                partition: tiledLinkReference.link_here_tile_id,
                id: tiledLinkReference.link_id
            };
        };

        // Only what we want to expose
        return {
            linksToPlatform: linksToPlatform,
            drivablePathsToPlatform: drivablePathsToPlatform,
            lineString2dOffsetToPlatform: lineString2dOffsetToPlatform,
            lineString3dOffsetToPlatform: lineString3dOffsetToPlatform,
            point3dOffsetToPlatform: point3dOffsetToPlatform,
            parametricRangeToRange: parametricRangeToRange,
            tiledLinkReferenceToFeatureRef: tiledLinkReferenceToFeatureRef
        };

    };


    /* -------------------------------------------------
     * Utility functions for geometry messages
     * -------------------------------------------------
     */

    exports.Line2d = function (logger, geo) {

        logger.info("Initializing Line2d module.");

        // Constants
        const Direction = {
            LEFT: 'left',
            RIGHT: 'right'
        };

        /*
         * Calculates the length of a path defined by a com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const calculateLength = function (lineString2d) {
            let length = 0;
            if (lineString2d && lineString2d.linestring_points && lineString2d.linestring_points.length > 1) {
                const points = lineString2d.linestring_points;
                for (let i = 0; i < points.length - 1; i++) {
                    const start = points[i];
                    const end = points[i + 1];
                    length += geo.distance(
                        start.latitude_degrees, start.longitude_degrees,
                        end.latitude_degrees, end.longitude_degrees);
                }
            }
            return length;
        }

        /*
         * Returns an array with the bearings between consecutive points in a
         * com.here.pb.hdmap.platform.v1.geometry.LineString2d
         */
        const calculateBearings = function (lineString2d) {
            const bearings = [];
            const points = lineString2d.linestring_points;
            if (points.length > 1) {
                for (let i = 0; i < points.length - 1; i++) {
                    const start = points[i];
                    const end = points[i + 1];
                    const bearing = geo.bearing(
                        start.latitude_degrees, start.longitude_degrees,
                        end.latitude_degrees, end.longitude_degrees);
                    bearings.push(bearing);
                }
            }
            return bearings;
        }

        /*
         * Finds the point at the given length in a com.here.pb.hdmap.platform.v1.geometry.LineString2d
         * path.
         */
        const along = function (lineString2d, length) {
            const points = lineString2d.linestring_points;
            let currentLength = 0;
            for (let i = 0; i < points.length - 1; i++) {
                const start = points[i];
                const end = points[i + 1];
                const d = geo.distance(
                    start.latitude_degrees, start.longitude_degrees,
                    end.latitude_degrees, end.longitude_degrees);
                const remainingLength = length - currentLength;
                if (remainingLength < d) {
                    return geo.along(
                        start.latitude_degrees, start.longitude_degrees,
                        end.latitude_degrees, end.longitude_degrees,
                        remainingLength);
                } else {
                    currentLength += d;
                }
            }
            return points[points.length - 1];
        }

        /*
         * Cuts the com.here.pb.hdmap.platform.v1.geometry.LineString2d geometry according
         * to the cutting points determined by the ranges given as a parameter.
         */
        const cut = function (lineString2d, ranges, length) {
            const segmentsInRange = [];
            const segmentsOutRange = [];
            const points = lineString2d.linestring_points;
            const rangePoints = flatRanges(ranges, 0.0, 1.0);

            let pointIndex = 0;
            let start = points[pointIndex];
            let end = points[pointIndex + 1];

            let rangeIndex = 0;
            let rangeStart = rangePoints[rangeIndex];
            let rangeEnd = rangePoints[rangeIndex + 1];

            let segment = [ start ];
            let currentLength = 0;
            let targetLength = rangeEnd.value * length;
            while (pointIndex < points.length - 1 && rangeIndex < rangePoints.length - 1) {
                if (rangeIndex < rangePoints.length - 2) {
                    const d = geo.distance(
                        start.latitude_degrees, start.longitude_degrees,
                        end.latitude_degrees, end.longitude_degrees);
                    const remainingLength = targetLength - currentLength;
                    if (remainingLength <= d) {
                        const targetPoint = geo.along(
                            start.latitude_degrees, start.longitude_degrees,
                            end.latitude_degrees, end.longitude_degrees,
                            remainingLength);
                        segment.push(targetPoint);
                        start = targetPoint;
                        currentLength += remainingLength;

                        const geometry = { linestring_points: segment };
                        if (rangeStart.inRange) {
                            segmentsInRange.push(geometry);
                        } else {
                            segmentsOutRange.push(geometry);
                        }
                        segment = [ start ];

                        rangeIndex += 1;
                        rangeStart = rangePoints[rangeIndex];
                        rangeEnd = rangePoints[rangeIndex + 1];
                        targetLength = rangeEnd.value * length;
                    } else {
                        segment.push(end);
                        currentLength += d;
                        pointIndex += 1;
                        start = points[pointIndex];
                        end = points[pointIndex + 1];
                    }
                } else {
                    // in the last range add the remaining points to the current segment.
                    segment.push(end);
                    pointIndex += 1;
                    start = points[pointIndex];
                    end = points[pointIndex + 1];
                    if (pointIndex == points.length - 1) {
                        const geometry = { linestring_points: segment };
                        if (rangeStart.inRange)  {
                            segmentsInRange.push(geometry);
                        } else {
                            segmentsOutRange.push(geometry);
                        }
                        rangeIndex += 1;
                    }
                }
            }
            return {
                inRange: segmentsInRange,
                outRange: segmentsOutRange
            };
        }

        /*
         * Builds an array of values corresponding to the ranges.
         * Includes the min and max values if they are not initially included
         * in the ranges. e.g. ([0.1, 0.5], 0, 1) -> [0, 0.1, 0.5, 1]
         */
        const flatRanges = function (ranges, min, max) {
            if (ranges.length < 1) {
                return [
                    { value: min, inRange: false },
                    { value: max, inRange: false }
                ];
            }
            const values = [];
            const first = ranges[0];
            if (min < first.start) {
                values.push({ value: min, inRange: false });
            }
            for (let i = 0; i < ranges.length; i++) {
                const range = ranges[i];
                values.push({ value: range.start, inRange: true });
                values.push({ value: range.end, inRange: false });
            }
            const last = ranges[ranges.length - 1];
            if (last.end < max) {
                values.push({ value: max, inRange: false });
            }
            return values;
        }

        /*
         * Shifts a com.here.pb.hdmap.platform.v1.geometry.LineString2d to left or right
         * depending on the logical orientation of the line defined by the order of its points.
         */
        const shift = function (lineString2d, direction, distance, lineBearings) {
            const lineShifted = [];
            const points = lineString2d.linestring_points;
            const bearings = lineBearings || calculateBearings(lineString2d);
            const offset = (direction == Direction.LEFT) ? -90 : 90;

            // initial point
            const lineStart = points[0];
            const lineStartBearing = bearings[0];
            const lineStartShifted = geo.destinationPoint(
                lineStart.latitude_degrees, lineStart.longitude_degrees,
                lineStartBearing + offset, distance);
            lineShifted.push(lineStartShifted);

            // intermediate points
            if (points.length > 2) {
                for (let i = 1; i < points.length - 1; i++) {
                    const start = points[i - 1];
                    const end = points[i + 1];
                    const startBearing = bearings[i - 1];
                    const endBearing = bearings[i];
                    const startShifted = geo.destinationPoint(
                        start.latitude_degrees, start.longitude_degrees,
                        startBearing + offset, distance);
                    const endShifted = geo.destinationPoint(
                        end.latitude_degrees, end.longitude_degrees,
                        endBearing + offset, distance);
                    let middlePoint = geo.intersection(
                        startShifted.latitude_degrees, startShifted.longitude_degrees, startBearing,
                        endShifted.latitude_degrees, endShifted.longitude_degrees, endBearing + 180);
                    if (!middlePoint) {
                        const middle = points[i];
                        middlePoint = geo.destinationPoint(
                            middle.latitude_degrees, middle.longitude_degrees,
                            startBearing + offset, distance);
                    }
                    lineShifted.push(middlePoint);
                }
            }

            // final point
            const lineEnd = points[points.length - 1];
            const lineEndBearing = bearings[bearings.length - 1];
            const lineEndShifted = geo.destinationPoint(
                lineEnd.latitude_degrees, lineEnd.longitude_degrees,
                lineEndBearing + offset, distance);
            lineShifted.push(lineEndShifted);

            return { linestring_points: lineShifted };
        }

        /*
         * Calculates the middle point of a segment inside a com.here.pb.hdmap.platform.v1.geometry.LineString2d
         * The segment is defined by a range with start and end values in [0, 1].
         * The length is the total length of the point string.
         */
        const findSegmentMiddlePoint = function (lineString2d, range, length) {
            const rangeStart = length * range.start;
            const rangeEnd = length * range.end;
            const segmentStart = along(lineString2d, rangeStart);
            const segmentEnd = along(lineString2d, rangeEnd);
            const segmentLength = geo.distance(
                segmentStart.latitude_degrees, segmentStart.longitude_degrees,
                segmentEnd.latitude_degrees, segmentEnd.longitude_degrees);
            const segmentMiddlePoint = geo.along(
                segmentStart.latitude_degrees, segmentStart.longitude_degrees,
                segmentEnd.latitude_degrees, segmentEnd.longitude_degrees,
                segmentLength / 2);
            return {
                middlePoint: segmentMiddlePoint,
                segmentLength: segmentLength
            };
        }

        // Only what we want to expose
        return {
            Direction: Direction,
            calculateLength: calculateLength,
            calculateBearings: calculateBearings,
            along: along,
            cut: cut,
            shift: shift,
            findSegmentMiddlePoint: findSegmentMiddlePoint
        };

    };


    /* -------------------------------------------------
     * Basic geometries rendering
     * -------------------------------------------------
     */

    exports.Render = function (logger, geo, line2d, mapUtils) {

        logger.info("Initializing Renderer module.");

        /*
         * Converts a com.here.pb.hdmap.platform.v1.geometry.LineString2d
         * to an array of coordinates [lon, lat].
         */
        const lineString2dToCoordinates = function (lineString2d) {
            const coordinates = [];
            const points = lineString2d.linestring_points;
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                coordinates.push([ point.longitude_degrees, point.latitude_degrees ]);
            }
            return coordinates;
        };

        /*
         * Converts a com.here.pb.hdmap.platform.v1.geometry.LineString3d
         * to an array of coordinates [lon, lat].
         */
        const lineString3dToCoordinates = function (lineString3d) {
            const coordinates = [];
            const points = lineString3d.linestring_points;
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                coordinates.push([ point.lat_lon.longitude_degrees, point.lat_lon.latitude_degrees ]);
            }
            return coordinates;
        };

        /*
         * Converts an array of com.here.pb.hdmap.platform.v1.geometry.LineString2d
         * to an array of line coordinates [[lon, lat]].
         */
        const multiLineString2dToCoordinates = function (multiLineString2d) {
            const coordinates = [];
            for (let i = 0; i < multiLineString2d.length; i++) {
                const lineString2d = multiLineString2d[i];
                const lineCoordinates = lineString2dToCoordinates(lineString2d);
                coordinates.push(lineCoordinates);
            }
            return coordinates;
        };

        /*
         * Converts a com.here.pb.hdmap.external.v1.geometry.LineString2dOffset
         * to an array of coordinates [lon, lat].
         */
        const lineString2dOffsetToCoordinates = function (lineString2dOffset, offset) {
            const coordinates = [];
            let lastDiff = offset;
            const diffs = lineString2dOffset.here_2d_coordinate_diffs;
            for (let i = 0; i < diffs.length; i++) {
                const diff = diffs[i];
                const here2dCoordinate = lastDiff.xor(diff);
                const point = mapUtils.hdmapCoordinateToLonLat(here2dCoordinate);
                coordinates.push(point);
                lastDiff = here2dCoordinate;
            }
            return coordinates;
        };

        /*
         * Converts an array of com.here.pb.hdmap.platform.v1.geometry.Point2d
         * to an array of line coordinates [[lon, lat]].
         */
        const multiPoint2dToCoordinates = function (multiPoint2d) {
            const coordinates = [];
            for (let i = 0; i < multiPoint2d.length; i++) {
                const point2d = multiPoint2d[i];
                coordinates.push([ point2d.longitude_degrees, point2d.latitude_degrees ]);
            }
            return coordinates;
        };

        /*
         * Converts an array of com.here.pb.hdmap.platform.v1.geometry.Point3d
         * to an array of line coordinates [[lon, lat]].
         */
        const multiPoint3dToCoordinates = function (multiPoint3d) {
            const coordinates = [];
            for (let i = 0; i < multiPoint3d.length; i++) {
                const point3d = multiPoint3d[i];
                coordinates.push([ point3d.lat_lon.longitude_degrees, point3d.lat_lon.latitude_degrees ]);
            }
            return coordinates;
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.Point2d geometry
         * as a Point GeoJSON feature.
         */
        const renderPoint2d = function (point2d, radius, color, fillColor, tooltip) {
            return {
                type: "Feature",
                properties: {
                    radius: radius,
                    tooltip: tooltip,
                    style: {
                        color: color,
                        fill: fillColor
                    },
                },
                geometry: {
                    type: "Point",
                    coordinates: [ point2d.longitude_degrees, point2d.latitude_degrees ]
                }
            };
        };

        /*
         * Renders an array of com.here.pb.hdmap.platform.v1.geometry.Point2d geometries
         * as a MultiPoint GeoJSON feature.
         */
        const renderMultiPoint2d = function (multiPoint2d, radius, color, fillColor, tooltip) {
            const coordinates = multiPoint2dToCoordinates(multiPoint2d);
            return createMultiPointFeature(coordinates, radius, color, fillColor, tooltip);
        };

        /*
         * Renders an array of com.here.pb.hdmap.platform.v1.geometry.Point3d geometries
         * as a MultiPoint GeoJSON feature.
         */
        const renderMultiPoint3d = function (multiPoint3d, radius, color, fillColor, tooltip) {
            const coordinates = multiPoint3dToCoordinates(multiPoint3d);
            return createMultiPointFeature(coordinates, radius, color, fillColor, tooltip);
        };

        /*
         * Creates a multi point feature.
         */
        const createMultiPointFeature = function (coordinates, radius, color, fillColor, tooltip) {
            return {
                type: "Feature",
                properties: {
                    radius: radius,
                    tooltip: tooltip,
                    style: {
                        color: color,
                        fill: fillColor
                    },
                },
                geometry: {
                    type: "MultiPoint",
                    coordinates: coordinates
                }
            };
        }

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.Point3d geometry
         * as a Point GeoJSON feature.
         */
        const renderPoint3d = function (point3d, radius, color, fillColor, tooltip) {
            return renderPoint2d(point3d.lat_lon, radius, color, fillColor, tooltip);
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString2d geometry
         * as a LineString GeoJSON feature.
         */
        const renderLineString2d = function (lineString2d, color, width, tooltip, props) {
            const coordinates = lineString2dToCoordinates(lineString2d);
            const feature = {
                type: "Feature",
                properties: {
                    style: {
                        color: color,
                        width: width
                    },
                    tooltip: tooltip
                },
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                }
            };
            if (props) {
                Object.assign(feature.properties, props);
            }
            return feature;
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString3d geometry
         * as a LineString GeoJSON feature.
         */
        const renderLineString3d = function (lineString3d, color, width, tooltip, props) {
            const coordinates = lineString3dToCoordinates(lineString3d);
            const feature = {
                type: "Feature",
                properties: {
                    style: {
                        color: color,
                        width: width
                    },
                    tooltip: tooltip
                },
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                }
            };
            if (props) {
                Object.assign(feature.properties, props);
            }
            return feature;
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString2d geometry
         * as a MultiPoint GeoJSON feature.
         */
        const renderLineString2dPoints = function (lineString2d, radius, color, fillColor, tooltip) {
            const coordinates = lineString2dToCoordinates(lineString2d);
            return {
                type: "Feature",
                properties: {
                    radius: radius,
                    tooltip: tooltip,
                    style: {
                        color: color,
                        fill: fillColor
                    },
                },
                geometry: {
                    type: "MultiPoint",
                    coordinates: coordinates
                }
            };
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString2d geometry
         * as a MultiPoint GeoJSON feature.
         */
        const renderLineString2dPolygon = function (lineString2d, color, fillColor, width, tooltip) {
            const coordinates = lineString2dToCoordinates(lineString2d);
            return createPolygonFeature(coordinates, color, fillColor, width, tooltip);
        };

        /*
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString3d geometry
         * as a MultiPoint GeoJSON feature.
         */
        const renderLineString3dPolygon = function (lineString3d, color, fillColor, width, tooltip) {
            const coordinates = lineString3dToCoordinates(lineString3d);
            return createPolygonFeature(coordinates, color, fillColor, width, tooltip);
        };

        /*
         * Create a single Polygon GeoJSON feature.
         */
        const createPolygonFeature = function (coordinates, color, fillColor, width, tooltip) {
            return {
                type: "Feature",
                properties: {
                    style: {
                        color: color,
                        fill: fillColor,
                        width: width
                    },
                    tooltip: tooltip
                },
                geometry: {
                    type: "Polygon",
                    coordinates: coordinates
                }
           };
        };

        /**
         * Renders a com.here.pb.hdmap.platform.v1.geometry.LineString2d geometry
         * as a LineString GeoJSON feature with arrows every arrowSpacing.
         *
         * Options is an object { pointRadius, arrowSpacing, arrowHeight, arrowWidth }
         */
        const renderLineString2dArrows = function (lineString2d, color, width, tooltip, options) {
            const directedLinePoints = [];
            const length = line2d.calculateLength(lineString2d);
            const arrowSpacing = length / (Math.floor(length / options.arrowSpacing) + 1);
            const points = lineString2d.linestring_points;
            let pointIndex = 0;
            let remainingSpacing = arrowSpacing;
            let isLastSegment;
            let segmentStartPoint;
            let segmentEndPoint;
            while (pointIndex < points.length - 1) {
                isLastSegment = pointIndex == points.length - 2;
                segmentStartPoint = points[pointIndex];
                segmentEndPoint = points[pointIndex + 1];
                directedLinePoints.push(segmentStartPoint);

                while (true) {
                    const distanceToEnd = geo.distance(
                        segmentStartPoint.latitude_degrees, segmentStartPoint.longitude_degrees,
                        segmentEndPoint.latitude_degrees, segmentEndPoint.longitude_degrees);
                    if (isLastSegment) {
                        const arrowSpacingMarginError = remainingSpacing + (remainingSpacing / 10);
                        if (distanceToEnd < arrowSpacingMarginError) {
                            const brn = geo.bearing(
                                segmentEndPoint.latitude_degrees, segmentEndPoint.longitude_degrees,
                                segmentStartPoint.latitude_degrees, segmentStartPoint.longitude_degrees);
                            const adjustedEndPoint = geo.destinationPoint(
                                segmentEndPoint.latitude_degrees, segmentEndPoint.longitude_degrees,
                                brn, options.pointRadius);
                            directedLinePoints.pushArray(
                                createArrowPoints(
                                    segmentStartPoint, adjustedEndPoint,
                                    options.arrowHeight, options.arrowWidth));
                            directedLinePoints.push(segmentEndPoint);
                            pointIndex += 1;
                            break;
                        }
                    }

                    if (remainingSpacing < distanceToEnd) {
                        const intermediatePoint = geo.along(
                            segmentStartPoint.latitude_degrees, segmentStartPoint.longitude_degrees,
                            segmentEndPoint.latitude_degrees, segmentEndPoint.longitude_degrees,
                            remainingSpacing);
                        const arrowPoints = createArrowPoints(
                            segmentStartPoint, intermediatePoint,
                            options.arrowHeight, options.arrowWidth);
                        directedLinePoints.pushArray(arrowPoints);
                        segmentStartPoint = intermediatePoint;
                        remainingSpacing = arrowSpacing;
                    } else {
                        pointIndex += 1;
                        remainingSpacing -= distanceToEnd;
                        break;
                    }
                }
            }
            const directedGeometry = { linestring_points: directedLinePoints };
            return [
                renderPoint2d(points[0], options.pointRadius, color, color, tooltip),
                renderLineString2d(directedGeometry, color, width, tooltip)
            ];
        };

        /**
         * Creates the points that defines an arrow in the end of a line defined
         * by the parameters start and end point.
         */
        const createArrowPoints = function (startPoint, endPoint, arrowHeight, arrowWidth) {
            const arrowWidthHalf = arrowWidth / 2;
            const brn = geo.bearing(
                endPoint.latitude_degrees, endPoint.longitude_degrees,
                startPoint.latitude_degrees, startPoint.longitude_degrees);
            const arrowFoot = geo.destinationPoint(
                endPoint.latitude_degrees, endPoint.longitude_degrees,
                brn, arrowHeight);
            const arrowLeftPoint = geo.destinationPoint(
                arrowFoot.latitude_degrees, arrowFoot.longitude_degrees,
                ((brn - 90) + 360) % 360, arrowWidthHalf);
            const arrowRightPoint = geo.destinationPoint(
                arrowFoot.latitude_degrees, arrowFoot.longitude_degrees,
                ((brn + 90) + 360) % 360, arrowWidthHalf);
            // There is a more efficient way to define the arrow but the following
            // gives better results graphically in the inspector.
            return [ arrowFoot, arrowLeftPoint, endPoint,
                     arrowRightPoint, arrowFoot, endPoint ];
        };

        /*
         * Renders an array of com.here.pb.hdmap.platform.v1.geometry.LineString2d geometries
         * as a MultiLineString GeoJSON feature.
         */
        const renderMultiLineString2d = function (multiLineString2d, color, width, tooltip) {
            const coordinates = multiLineString2dToCoordinates(multiLineString2d);
            return {
                type: "Feature",
                properties: {
                    style: {
                        color: color,
                        width: width
                    },
                    tooltip: tooltip
                },
                geometry: {
                    type: "MultiLineString",
                    coordinates: coordinates
                }
            };
        };

        /*
         * Renders a com.here.pb.hdmap.external.v1.geometry.LineString2dOffset geometry
         * as a LineString GeoJSON feature.
         */
        const renderLineString2dOffset = function (lineString2dOffset, offset, color, width, tooltip) {
            const coordinates = lineString2dOffsetToCoordinates(lineString2dOffset, offset);
            return {
                type: "Feature",
                properties: {
                    style: {
                        color: color,
                        width: width
                    },
                    tooltip: tooltip
                },
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                }
            };
        };

        /*
         * Renders a com.here.pb.hdmap.external.v1.geometry.Point2d codified by an offset
         * as a Point GeoJSON feature.
         */
        const renderPoint2dOffset = function (point2dOffset, offset, radius, color, fillColor, tooltip) {
            const here2dCoordinate = offset.xor(point2dOffset.here_2d_coordinate);
            const point = mapUtils.hdmapCoordinateToLonLat(here2dCoordinate);
            return {
                type: "Feature",
                properties: {
                    radius: radius,
                    tooltip: tooltip,
                    style: {
                        color: color,
                        fill: fillColor
                    },
                },
                geometry: {
                    type: "Point",
                    coordinates: point
                }
            };
        };

        // Only what we want to expose
        return {
            renderPoint2d: renderPoint2d,
            renderPoint3d: renderPoint3d,
            renderLineString2d: renderLineString2d,
            renderLineString3d: renderLineString3d,
            renderLineString2dPoints: renderLineString2dPoints,
            renderLineString2dArrows: renderLineString2dArrows,
            renderLineString2dPolygon: renderLineString2dPolygon,
            renderLineString3dPolygon: renderLineString3dPolygon,
            renderMultiLineString2d: renderMultiLineString2d,
            renderLineString2dOffset: renderLineString2dOffset,
            renderPoint2dOffset: renderPoint2dOffset,
            renderMultiPoint2d: renderMultiPoint2d,
            renderMultiPoint3d: renderMultiPoint3d
        };
    };


    /* -------------------------------------------------
     * Functions for calculating distances and intermediate points
     * for spatial points.
     * -------------------------------------------------
     */

    exports.Geo = function (logger, mathUtils) {

        logger.info("Initializing Geo module.");

        // Earth radius in meters
        const R = 6371e3;

        /*
         * Converts degrees to radians.
         */
        const toRads = function (degrees) {
            return degrees * Math.PI / 180;
        };

        /*
         * Converts radians to degrees.
         */
        const toDegrees = function (rads) {
            return 180 * rads / Math.PI;
        };

        /*
         * Calculates the distance between two spatial points.
         */
        const distance = function (lat1, lon1, lat2, lon2) {
            const phi1 = toRads(lat1);
            const phi2 = toRads(lat2);
            const deltaPhi = toRads(lat2 - lat1);
            const deltaLambda = toRads(lon2 - lon1);

            const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;
            return d;
        };

        /*
         * Finds an intermediate point between two spatial points
         * moving from the first point towards the second point a given distance.
         */
        const along = function (lat1, lon1, lat2, lon2, targetDistance) {
            const length = distance(lat1, lon1, lat2, lon2);
            if (mathUtils.isEquivalent(length, 0.0) || mathUtils.isLessOrEqual(targetDistance, 0.0)) {
                return {
                    latitude_degrees: lat1,
                    longitude_degrees: lon1
                };
            } else if (mathUtils.isGreaterOrEqual(targetDistance, length)) {
                return {
                    latitude_degrees: lat2,
                    longitude_degrees: lon2
                };
            }

            const phi1 = toRads(lat1);
            const phi2 = toRads(lat2);
            const lambda1 = toRads(lon1);
            const lambda2 = toRads(lon2);

            const cosPhi1 = Math.cos(phi1);
            const cosPhi2 = Math.cos(phi2);
            const cosLambda1 = Math.cos(lambda1);
            const cosLambda2 = Math.cos(lambda2);

            const sinPhi1 = Math.sin(phi1);
            const sinPhi2 = Math.sin(phi2);
            const sinLambda1 = Math.sin(lambda1);
            const sinLambda2 = Math.sin(lambda2);

            const f = targetDistance / length;
            const delta = length / R;
            const sinDelta = Math.sin(delta);
            const a = Math.sin((1 - f) * delta) / sinDelta;
            const b = Math.sin(f * delta) / sinDelta;
            const x = a * cosPhi1 * cosLambda1 + b * cosPhi2 * cosLambda2;
            const y = a * cosPhi1 * sinLambda1 + b * cosPhi2 * sinLambda2;
            const z = a * sinPhi1 + b * sinPhi2;

            const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
            const lambda = Math.atan2(y, x);
            return {
                latitude_degrees: toDegrees(phi),
                longitude_degrees: toDegrees(lambda)
            };
        };

        /**
         * Calculates the bearing/angle of a path defined by two geographical points.
         */
        const bearing = function (lat1, lon1, lat2, lon2) {
            const phi1 = toRads(lat1);
            const phi2 = toRads(lat2);
            const deltaLambda = toRads(lon2 - lon1);
            const y = Math.sin(deltaLambda) * Math.cos(phi2);
            const x = Math.cos(phi1) * Math.sin(phi2) -
                      Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
            const b = Math.atan2(y, x);
            return (toDegrees(b) + 360) % 360;
        };

        /**
         * Returns the destination point starting from the lat,lon and moving
         * the distance in the bearing direction.
         */
        const destinationPoint = function (lat, lon, bearing, distance) {
            const phi = toRads(lat);
            const lambda = toRads(lon);
            const b = toRads(bearing);
            const d = distance / R;
            const phi2 = Math.asin(Math.sin(phi) * Math.cos(d) +
                                   Math.cos(phi) * Math.sin(d) * Math.cos(b));
            const lambda2 = lambda + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(phi),
                                                Math.cos(d) - Math.sin(phi) * Math.sin(phi2));
            return {
                latitude_degrees: toDegrees(phi2),
                longitude_degrees: ((toDegrees(lambda2) + 540) % 360) - 180
            };
        };

        /**
         * Returns the intersection for two paths defined by the start point
         * and the bearing of the path.
         */
        const intersection = function (lat1, lon1, brg1, lat2, lon2, brg2) {
            const phi1 = toRads(lat1);
            const phi2 = toRads(lat2);
            const lambda1 = toRads(lon1);
            const lambda2 = toRads(lon2);
            const theta13 = toRads(brg1);
            const theta23 = toRads(brg2);
            const deltaPhi = phi2 - phi1;
            const deltaLambda = lambda2 - lambda1;

            const deltaPhiHalf = deltaPhi / 2;
            const deltaLambdaHalf = deltaLambda / 2;
            const deltaPhiHalfSin = Math.sin(deltaPhiHalf);
            const deltaLambdaHalfSin = Math.sin(deltaLambdaHalf);
            const d12 = 2 * Math.asin(Math.sqrt(
                                deltaPhiHalfSin * deltaPhiHalfSin +
                                Math.cos(phi1) * Math.cos(phi2) * deltaLambdaHalfSin * deltaLambdaHalfSin));
            if (mathUtils.isEquivalent(d12, 0)) return null;

            let thetaA = Math.acos((Math.sin(phi2) - Math.sin(phi1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(phi1)));
            let thetaB = Math.acos((Math.sin(phi1) - Math.sin(phi2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(phi2)));
            if (isNaN(thetaA)) thetaA = 0; // protect against rounding e.g. acos(1.0000000000001357)
            if (isNaN(thetaB)) thetaB = 0; // protect against rounding e.g. acos(1.0000000000001357)
            const theta12 = (Math.sin(deltaLambda) > 0) ? thetaA : (mathUtils.PI_2 - thetaA);
            const theta21 = (Math.sin(deltaLambda) > 0) ? (mathUtils.PI_2 - thetaB) : thetaB;

            const alpha1 = theta13 - theta12;
            const alpha2 = theta21 - theta23;
            const alpha1Sin = Math.sin(alpha1);
            const alpha2Sin = Math.sin(alpha2);

            if (mathUtils.isEquivalent(alpha1Sin, 0)
                && mathUtils.isEquivalent(alpha2Sin, 0)) return null;
            if (alpha1Sin * alpha2Sin < 0) return null;

            const alpha1Cos = Math.cos(alpha1);
            const alpha2Cos = Math.cos(alpha2);

            const alpha3 = Math.acos(-alpha1Cos * alpha2Cos + alpha1Sin * alpha2Sin * Math.cos(d12));
            const d13 = Math.atan2(Math.sin(d12) * alpha1Sin * alpha2Sin, alpha2Cos + alpha1Cos * Math.cos(alpha3));
            const phi3 = Math.asin(Math.sin(phi1) * Math.cos(d13) + Math.cos(phi1) * Math.sin(d13) * Math.cos(theta13));
            const deltaLambda13 = Math.atan2(Math.sin(theta13) * Math.sin(d13) * Math.cos(phi1), Math.cos(d13) - Math.sin(phi1) * Math.sin(phi3));
            const lambda3 = lambda1 + deltaLambda13;

            return {
                latitude_degrees: toDegrees(phi3),
                longitude_degrees: ((toDegrees(lambda3) + 540) % 360) - 180
            };
        };

        // Only what we want to expose
        return {
            distance: distance,
            along: along,
            bearing: bearing,
            destinationPoint: destinationPoint,
            intersection: intersection
        };

    };


    /* -------------------------------------------------
     * Math utility functions.
     * -------------------------------------------------
     */

    exports.MathUtils = function (logger, properties) {

        logger.info("Initializing MathUtils module.");

        // Constants
        const PI_2 = 2 * Math.PI;

        // Comparison tolerance value
        const props = Object.assign({
            comparisonTolerance: Number.EPSILON,
            roundDecimalFactor: 1e12
        }, properties);

        /*
         * Comparison of floating points with tolerance value (==).
         */
        const isEquivalent = function (n1, n2) {
            return Math.abs(n1 - n2) <= props.comparisonTolerance;
        };

        /*
         * Comparison of floating points with tolerance value (<=).
         */
        const isLessOrEqual = function (n1, n2) {
            return isEquivalent(n1, n2) || n1 < n2;
        };

        /*
         * Comparison of floating points with tolerance value (>=).
         */
        const isGreaterOrEqual = function (n1, n2) {
            return isEquivalent(n1, n2) || n1 > n2;
        };

        /*
         * Comparison of floating points with tolerance value (<).
         */
        const isLess = function (n1, n2) {
            return !isEquivalent(n1, n2) && n1 < n2;
        };

        /*
         * Comparison of floating points with tolerance value (>).
         */
        const isGreater = function (n1, n2) {
            return !isEquivalent(n1, n2) && n1 > n2;
        };

        /*
         * Rounds the decimal number.
         */
        const round = function (n) {
            return Math.round(n * props.roundDecimalFactor) / props.roundDecimalFactor;
        };

        // Only what we want to expose
        return {
            PI_2: PI_2,
            isEquivalent: isEquivalent,
            isLessOrEqual: isLessOrEqual,
            isGreaterOrEqual: isGreaterOrEqual,
            isLess: isLess,
            isGreater: isGreater,
            round: round
        };

    };


    /* -------------------------------------------------
     * Functions to work with ranges.
     * -------------------------------------------------
     */

    exports.Range = function (logger) {

        logger.info("Initializing Range module.");

        /*
         * Merge the overlapping ranges in a single range.
         */
        const mergeAll = function (ranges) {
            if (ranges.length <= 1) return ranges;
            ranges.sort(function (r1, r2) {
                return r1.start - r2.start;
            });
            const merged = [];
            const first = ranges[0];
            let start = first.start;
            let end = first.end;
            for (let i = 1; i < ranges.length; i++) {
                const range = ranges[i];
                if (range.start > end) {
                    merged.push({ start: start, end: end });
                    start = range.start;
                    end = range.end;
                }
                if (range.end > end) {
                    end = range.end;
                }
            }
            merged.push({ start: start, end: end });
            return merged;
        };

        // Only what we want to expose
        return {
            mergeAll: mergeAll
        };

    };


    /* -------------------------------------------------
     * Functions to work with Protobuf message definitions.
     * -------------------------------------------------
     */

    exports.Proto = function (logger) {

        logger.info("Initializing Protobuf Utils (Proto) module.");

        /**
         * Utility function to get a protobuf message type or enum metadata object.
         * Protobuf metadata is a nested object following the package structure of
         * protobuf definitions.
         *
         * @param protobuf
         *              root of protobuf metadata
         * @param name
         *              the name of the message type or enum name to look for
         */
        const findMetadata = function (protobuf, name) {
            if (!protobuf) {
                return null;
            }
            if (name === ".") {
                return protobuf;
            }
            const parts = name.split(".");
            let children = getChildren(protobuf);
            let meta = null;
            let i = 0;
            for (; i < parts.length; i++) {
                if (!children) {
                    break;
                }
                for (let j = 0; j < children.length; j++) {
                    if (children[j].name === parts[i]) {
                        meta = children[j];
                        if (children[j].nested) {
                            children = getChildren(children[j]);
                        }
                        break;
                    }
                    meta = null;
                }
            }
            if (i === parts.length) {
                return meta;
            } else {
                return null;
            }
        };

        /**
         * Utility function to get the associated type of a protobuf metadata object.
         *
         * @param meta
         *              root of protobuf metadata
         */
        const getChildren = function (meta) {
            let children = [];
            if (meta.resolvedType && meta.resolvedType._fieldsArray) {
                children = meta.resolvedType._fieldsArray;
            } else if (meta._fieldsArray) {
                children = meta._fieldsArray;
            } else if (meta.nested) {
                for (var item in meta.nested) {
                    children.push(meta.nested[item]);
                }
            }
            return children;
        };

        /**
         * Utility function to get a enum name version.
         *
         * @param enumMetadata
         *              the protobuf metadata of the enum
         * @param value
         *              the enum value
         */
        const getEnumName = function (enumMetadata, value) {
            if (enumMetadata) {
                const name = enumMetadata.valuesById[value];
                if (name) {
                    return name;
                }
            }
            return "UNKNOWN";
        };

        // Only what we want to expose
        return {
            findMetadata: findMetadata,
            getEnumName: getEnumName
        };
    };


    /* -------------------------------------------------
     * Functions for the setup and load of the involved tiles.
     * -------------------------------------------------
     */

    exports.Loader = function (logger, context) {

        /* -------------------------------------------------
         * Functions to get catalog dependencies and data.
         * -------------------------------------------------
         */

        // Layers and catalogs constants
        const PLATFORM_ROADS_REG_EXP = /^here(-\w+)?-hdmap-platform-(\w+)-(\d+)$/;
        const PLATFORM_LANES_REG_EXP = /^here(-\w+)?-hdmap-platform-lanes-(\w+)-(\d+)$/;
        const ROAD_TOPOLOGY_GEOMETRY_LAYER_NAME = "road-topology-geometry";
        const LANE_TOPOLOGY_LAYER_NAME = "lane-topology";
        const LOCAL_BARRIER_LAYER_NAME = "local-barrier";
        const LOCAL_SIGN_LAYER_NAME = "local-sign";
        const EXTERNAL_TOPOLOGY_GEOMETRY_LAYER_NAME = "topology-geometry";
        const EXTERNAL_LANE_TOPOLOGY_LAYER_NAME = "lane-topology";
        const EXTERNAL_LOCAL_BARRIER_LAYER_NAME = "localization-barrier";
        const EXTERNAL_LOCAL_SIGN_LAYER_NAME = "localization-sign";
        const EXTERNAL_LOCAL_POLE_LAYER_NAME = "localization-pole";
        const EXTERNAL_LOCAL_OSF_LAYER_NAME = "localization-overhead-structure-face";
        const EXTERNAL_LANE_ROAD_REFERENCES = "lane-road-references";
        const EXTERNAL_ALPHA_LOCAL_CROSSWALK_LAYER_NAME = "alpha-crosswalk";
        const EXTERNAL_ALPHA_LOCAL_TRAFFIC_SIGNAL_LAYER_NAME = "alpha-traffic-signal";
        const EXTERNAL_ALPHA_LOCAL_STOP_LINE_LAYER_NAME = "alpha-stop-line";

        /*
         * Gets the platform catalog dependency of the current version.
         */
        const getPlatformRoadsCatalogDependency = function (dependencies) {
            for (const dependency of dependencies) {
                if (PLATFORM_ROADS_REG_EXP.test(dependency.name.trim())) {
                    return dependency;
                }
            }
            return null;
        };

        /*
         * Gets the platform lane catalog dependency of the current version.
         */
        const getPlatformLanesCatalogDependency = function (dependencies) {
            for (const dependency of dependencies) {
                if (PLATFORM_LANES_REG_EXP.test(dependency.name.trim())) {
                    return dependency;
                }
            }
            return null;
        };

        /*
         * Loads all partition data
         */
        const loadAllPartitionData = function (catalogApi, partitions, version, layer) {
            const promises = [];
            for (const partition of partitions) {
                if (partition && partition.length > 0) {
                    const promise = loadPartitionData(catalogApi, partition, version, layer);
                    promises.push(promise);
                }
            }
            return Promise.all(promises);
        };

        /*
         * Loads partition data
         */
        const loadPartitionData = function (catalogApi, partition, version, layer) {
            logger.info("Loading %s layer for partition=%s, version=%s", layer, partition, version);
            return catalogApi.getPartitionDecoded(layer, partition, version).then(function (data) {
                return data.decoded;
            }, function (err) {
                logger.error("Error getting data for partition=%s, version=%s, layer=%s", partition, version, layer);
                return {};
            });
        };


        /* -------------------------------------------------
         * Functions for loading topology geometry tiles.
         * -------------------------------------------------
         */

        /*
         * Loads and transforms links geometries.
         */
        const loadTopologyGeometryTiles = function (partitions) {
            return context.catApi.getDependencies(context.version).then(function (dependencies) {
                const platformCatalog = getPlatformRoadsCatalogDependency(dependencies);
                if (platformCatalog) {
                    logger.info("Platform Roads catalog dependency found: name=%s, version=%s, hrn=%s",
                        platformCatalog.name, platformCatalog.version, platformCatalog.hrn);
                    logger.info("Loading topology geometry layer for partitions %s", partitions);
                    const platformCatalogApi = context.dsapi.getCatalogApiForHRN(platformCatalog.hrn, context.creds);
                    return loadAllPartitionData(platformCatalogApi, partitions, platformCatalog.version, ROAD_TOPOLOGY_GEOMETRY_LAYER_NAME);
                } else {
                    return Promise.reject("Platform catalog dependency not found");
                }
            });
        };

        /*
         * Loads all external topology geometry tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalTopologyGeometryTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_TOPOLOGY_GEOMETRY_LAYER_NAME);
        };

        /* -------------------------------------------------
         * Functions for loading lane topology tiles.
         * -------------------------------------------------
         */

        /**
         * Loads and transforms lane group geometries
         */
        const loadLaneTopologyTiles = function (partitions) {
            return context.catApi.getDependencies(context.version).then(function (dependencies) {
                const platformLaneCatalog = getPlatformLanesCatalogDependency(dependencies);
                if (platformLaneCatalog) {
                    logger.info("Platform Lanes catalog dependency found: name=%s, version=%s, hrn=%s",
                        platformLaneCatalog.name, platformLaneCatalog.version, platformLaneCatalog.hrn);
                    logger.info("Loading lane topology layer for partitions %s", partitions);
                    const platformLaneCatalogApi = context.dsapi.getCatalogApiForHRN(platformLaneCatalog.hrn, context.creds);
                    return loadAllPartitionData(platformLaneCatalogApi, partitions, platformLaneCatalog.version, LANE_TOPOLOGY_LAYER_NAME);
                } else {
                    return Promise.reject("Platform lane catalog dependency not found");
                }
            });
        };

        /*
         * Loads all external lane topology tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLaneTopologyTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LANE_TOPOLOGY_LAYER_NAME);
        };

        /* -------------------------------------------------
         * Functions for loading local barrier tiles.
         * -------------------------------------------------
         */

        /*
         * Loads all local barriers tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadLocalBarrierTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, LOCAL_BARRIER_LAYER_NAME);
        };

        /*
         * Loads all external localization barriers tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLocalBarrierTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LOCAL_BARRIER_LAYER_NAME);
        };

        /* -------------------------------------------------
         * Functions for loading local signs tiles.
         * -------------------------------------------------
         */

        /*
         * Loads all local signs tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadLocalSignTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, LOCAL_SIGN_LAYER_NAME);
        };

        /*
         * Loads all external localization signs tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLocalSignTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LOCAL_SIGN_LAYER_NAME);
        };

        /*
         * Loads all external localization poles tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLocalPoleTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LOCAL_POLE_LAYER_NAME);
        };

        /*
         * Loads all external localization OSFs tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLocalOsfTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LOCAL_OSF_LAYER_NAME);
        }

        /*
         * Loads all external alpha localization crosswalks tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalAlphaLocalCrosswalkTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_ALPHA_LOCAL_CROSSWALK_LAYER_NAME);
        }

        /*
         * Loads all external alpha localization traffic signal tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalAlphaLocalTrafficSignalTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_ALPHA_LOCAL_TRAFFIC_SIGNAL_LAYER_NAME);
        }

        /*
         * Loads all external alpha localization traffic signal tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalAlphaLocalStopLineTilesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_ALPHA_LOCAL_STOP_LINE_LAYER_NAME);
        }

        /* -------------------------------------------------
         * Functions for loading lane road references.
         * -------------------------------------------------
         */

        /*
         * Loads all external lane road references tiles using the context information.
         * This will try to load the layer from the same catalog that
         * is being processed.
         */
        const loadExternalLaneRoadReferencesFromContext = function (partitions) {
            return loadAllPartitionData(context.catApi, partitions, context.version, EXTERNAL_LANE_ROAD_REFERENCES);
        };

        // Only what we want to expose
        return {
            loadTopologyGeometryTiles: loadTopologyGeometryTiles,
            loadLaneTopologyTiles: loadLaneTopologyTiles,
            loadLocalBarrierTilesFromContext: loadLocalBarrierTilesFromContext,
            loadExternalTopologyGeometryTilesFromContext: loadExternalTopologyGeometryTilesFromContext,
            loadExternalLaneTopologyTilesFromContext: loadExternalLaneTopologyTilesFromContext,
            loadExternalLocalBarrierTilesFromContext: loadExternalLocalBarrierTilesFromContext,
            loadExternalLocalSignTilesFromContext: loadExternalLocalSignTilesFromContext,
            loadExternalLocalPoleTilesFromContext: loadExternalLocalPoleTilesFromContext,
            loadExternalLocalOsfTilesFromContext: loadExternalLocalOsfTilesFromContext,
            loadExternalLaneRoadReferencesFromContext: loadExternalLaneRoadReferencesFromContext,
            loadExternalAlphaLocalCrosswalkTilesFromContext: loadExternalAlphaLocalCrosswalkTilesFromContext,
            loadExternalAlphaLocalTrafficSignalTilesFromContext: loadExternalAlphaLocalTrafficSignalTilesFromContext,
            loadExternalAlphaLocalStopLineTilesFromContext: loadExternalAlphaLocalStopLineTilesFromContext
        };
    };


    /* -------------------------------------------------
     * Extension functions
     * -------------------------------------------------
     */

    /*
     * Adds the array elements to this array in place.
     */
    Array.prototype.pushArray = function (array) {
        for (var i = 0; i < array.length; i++) {
            this.push(array[i]);
        }
    }

})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.shared.v1.core.Common'] = {} : exports);
