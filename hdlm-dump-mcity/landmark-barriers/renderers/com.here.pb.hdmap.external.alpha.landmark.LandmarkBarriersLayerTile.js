/**
 * Plugin to convert com.here.pb.hdmap.external.alpha.LandmarkBarriersLayerTile layers to GeoJSON.
 */
(function(exports) {
    "use strict";
    var path = require('path');
    var appDir = path.dirname(require.main.filename);
    var pathToModule = appDir.replace('rest','web') + "/maputils"
    var mapUtils = require(pathToModule);
    const barrierTypeNames = {
        0: "BarrierType_UNKNOWN",
        1: "JERSEY_BARRIER",
        2: "GUARDRAIL",
        3: "CURB",
        4: "WALL",
        5: "FENCE",
        6: "TUNNEL_WALL"
    };

    // Load the topology layer
    exports.loadTopologyLayer = function(logger, lanesObject, context){
        logger.info("Loading lane-topology for partition "  + context.partition + ", version " + lanesObject.version);
        return context.dsapi.getCatalogApiForHRN(lanesObject.hrn, context.creds).getPartitionDecoded('lane-topology', context.partition, lanesObject.version).then(function (decodedPartitionData){
            if (decodedPartitionData.decoded.lane_groups_starting_in_tile.length > 0 ) {
                var laneTopologyData = decodedPartitionData.decoded;
                var laneTopologyObj = {lane_groups_starting_in_tile : laneTopologyData.lane_groups_starting_in_tile,
                                        lane_group_connectors_in_tile : laneTopologyData.lane_group_connectors_in_tile};
                return laneTopologyObj;
            }
        }, function(err){
            logger.info("Could not decode lane-topology partition");
            return {};
        });
    };

    exports.loadAndParseLaneTopologyLayer = function(logger, context){
        // Main logic. Get dependencies and load the platform lanes catalog
        return context.catApi.getDependencies(context.version).then(function(dependencies){
            var platformLanesHRNString = "lanes";
            for (var i = 0; i < dependencies.length; i++){
                if(dependencies[i].hrn.search(platformLanesHRNString) > 0  ){
                    var lanesObject = {hrn: dependencies[i].hrn, version: dependencies[i].version}
                    return exports.loadTopologyLayer(logger, lanesObject, context);
                }
            }
        }, function(err){
            logger.info("Could not load dependency list for barriers catalog")
            return {};
        });
    };

    exports.loadBarriersFromAnotherTile = function(logger, context, partitionToLoad){
    }

    exports.promiseToGeoJSON  = function(logger, layer, decodeResult, context) {

        var type = "application/vnd.geo+json; charset=utf-8";
        var data = decodeResult.decoded;
        if (!data.here_tile_id || !data.barriers_for_lane_groups) {
            logger.info("Source data is missing tile id or barriers for lane groups");
            return null;
        }

        return exports.loadAndParseLaneTopologyLayer(logger, context).then(function(laneTopologyObj){
            var result = {
                "type" : "FeatureCollection",
                "features" : []
            };

            logger.info("Going to render lane topology");
            //processing the lane_groups_starting_in_tile first
            result.features = processLaneGroups(laneTopologyObj.lane_groups_starting_in_tile);

            logger.info("Lane Topology layer conversion to GeoJSON successfully finished");

            // Process barriers message
            result.features =  result.features.concat(processBarriers(data.barriers, data.tile_center_here_3d_coordinate));

            logger.info("Finished processing geo json");

            return {
                contentType : type,
                body : result
            };
        }, function(err){
            logger.error("Failure:", err);
             return null;
         });
    };

    function processLaneGroups(laneGroups){
        var list = [];
        var laneGroupRefSubstringPos = 13;

        for(var i = 0; i<laneGroups.length; i++){
            if(laneGroups[i].boundary_geometry){
                var leftBoundary = processLinestringsArray(laneGroups[i].boundary_geometry.left_boundary.linestring_points, laneGroups[i].id.uri.substring(laneGroupRefSubstringPos)); //left boundary first
                var rightBoundary = processLinestringsArray(laneGroups[i].boundary_geometry.right_boundary.linestring_points, laneGroups[i].id.uri.substring(laneGroupRefSubstringPos)); //right boundary second*/
                // Fill the lane groups
                list.push(fillLaneGroups(leftBoundary, rightBoundary));
            }
        }
        return list;

    };

    function fillLaneGroups(leftBoundary, rightBoundary){
        // Using gray to color the lane groups. Note: we are not rendering HAD compliance
        var laneGroupColor = "rgba(0,0,0,0.9)";
        var laneGroupFill = "rgba(112,112,112,0.8)";

        var f = {
            type : "Feature",
            properties : {
                style: {
                    fill: "rgba(112,112,112,0.8)",
                    color: "rgba(0,0,0,0.9)"
                }
            },
            geometry : {
                type : "Polygon",
                coordinates : []
            }
        };

        var tempArr = [];
        tempArr = leftBoundary.geometry.coordinates;				//adding left boundary coordinates as is
        tempArr = tempArr.concat(rightBoundary.geometry.coordinates.reverse());	//reversing right boundary coordinates and adding them
        tempArr.push(leftBoundary.geometry.coordinates[0]);				//adding the first coordinate of left boundary to close the loop of coordinates and form proper polygon

        var outerArray = [] // Polygons are wrapped in an outer array
        outerArray.push(tempArr);
        f.geometry.coordinates = outerArray;

        return f;
    };

    function processLinestringsArray(array, id, style) {
        var f = {
            type : "Feature",
            properties : {
                id : id,
            },
            geometry : {
                type : "LineString",
                coordinates : []
            }
        };

        if(style){
            f.properties.style = style;
        }

        for(var i=0; i<array.length; i++){
            f.geometry.coordinates.push([array[i].longitude_degrees, array[i].latitude_degrees])
        }
        return f;
        };

    function processBarriers(barriers, centerPoint, barrierToMidPointMap){
        var results = [];
        // To toggle barrier colors
        var colors = ["RGB(0, 0, 255)", "RGB(255, 100, 0)"]

        for (var i = 0; i < barriers.length; i++){
            var color = i % 2;
            results.push(processIndividualBarrier(barriers[i], colors[color], centerPoint, barrierToMidPointMap));
        }

        return results;
    }

    function processIndividualBarrier(barrier, color, centerPoint, barrierToMidPointMap){
        var f = {
            type : "Feature",
            properties : {
                id: barrier.id,
                type: translateBarrierTypeEnum(barrier.type),
                style: {
                    color: color,
                    width: 3
                }
            },
            geometry : {
                type : "LineString",
                coordinates : []
            }
        };

        var lastDiff = centerPoint.here_2d_coordinate;
        var coordinates = barrier.barrier_geometry.here_2d_coordinate_diffs
        for(var i=0; i < coordinates.length; i++){
            var hdMapCoordinate = coordinates[i].xor(lastDiff);
            var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
            f.geometry.coordinates.push([lonLatCoordinate[0], lonLatCoordinate[1]])
            lastDiff = hdMapCoordinate;
        }
        return f;
    }

    function translateBarrierTypeEnum(barrierTypeIndex) {
        return barrierTypeNames[barrierTypeIndex] ? barrierTypeNames[barrierTypeIndex] : barrierTypeNames[0]
    }

})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.alpha.LandmarkBarriersLayerTile'] = {} : exports);