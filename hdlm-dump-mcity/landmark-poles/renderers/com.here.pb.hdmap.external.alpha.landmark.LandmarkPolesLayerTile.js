/**
 * Plugin to com.here.pb.hdmap.external.alpha.landmark.LandmarkPolesLayerTile layers to GeoJSON.
 */
(function(exports) {
    "use strict";
    var path = require('path');
    var appDir = path.dirname(require.main.filename);
    var pathToModule = appDir.replace('rest','web') + "/maputils"
    var mapUtils = require(pathToModule);

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
                if(dependencies[i].hrn.search(platformLanesHRNString) > 0 ) {
                    var lanesObject = {hrn: dependencies[i].hrn, version: dependencies[i].version}
                    return exports.loadTopologyLayer(logger, lanesObject, context);
                }
            }
        }, function(err){
            logger.info("Could not load dependency list for barriers catalog")
            return {};
        });
    };

    exports.promiseToGeoJSON  = function(logger, layer, decodeResult, context) {

        var type = "application/vnd.geo+json; charset=utf-8";
        var data = decodeResult.decoded;
        if (!data.here_tile_id || !data.poles_for_lane_groups) {
            logger.info("Source data is missing tile id or poles for lane groups");
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

            // Process poles
            result.features =  result.features.concat(processPolesForLaneGroup(data.poles_for_lane_groups, result.features));

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
                var leftBoundary = processLinestringsArray(laneGroups[i].boundary_geometry.left_boundary.linestring_points); //left boundary first
                var rightBoundary = processLinestringsArray(laneGroups[i].boundary_geometry.right_boundary.linestring_points); //right boundary second*/
                // Fill the lane groups
                list.push(fillLaneGroups(leftBoundary, rightBoundary, laneGroups[i].id.uri.substring(laneGroupRefSubstringPos)));
            }
        }
        return list;

    };

    function fillLaneGroups(leftBoundary, rightBoundary, laneGroupId){
        // Using gray to color the lane groups. Note: we are not rendering HAD compliance

        var f = {
            type : "Feature",
            properties : {
                lane_group_id: laneGroupId,
                style: {
                    fill: "rgba(112,112,112,0.5)",
                    color: "rgba(112,112,112,0.5)"
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

    function processLinestringsArray(array) {
        var f = {
            type : "Feature",
            properties : {
            },
            geometry : {
                type : "LineString",
                coordinates : []
            }
        };

        for(var i=0; i<array.length; i++){
            f.geometry.coordinates.push([array[i].longitude_degrees, array[i].latitude_degrees])
        }
        return f;
        };

    function processPolesForLaneGroup(poleForLaneGroup, laneGroupFeatures){
        var results = [];
        // To toggle barrier colors
        var colors = ["rgba(0, 0, 255, 1.0)", "rgba(255, 0, 0, 1.0)", "rgba(0, 130, 25, 1.0)", "rgba(255, 0, 246, 1.0)"];

        for (var i = 0; i < poleForLaneGroup.length; i++){
            var color = colors[i % 4];
            var colorObject = {
                c: color,
                f: color.replace("1.0)","0.3)")
            };
            results = results.concat(processIndividualPoleForLaneGroup(poleForLaneGroup[i], poleForLaneGroup[i].lane_group_ref.toString(), colorObject));
            updateLaneGroup(laneGroupFeatures, poleForLaneGroup[i].lane_group_ref.toString(), colorObject);
        }

        return results;
    }

    function processIndividualPoleForLaneGroup(poleForLaneGroup, laneGroupId, colorObject) {
        var results = [];
        for(var i = 0; i< poleForLaneGroup.poles.length; i++){
            results = results.concat(processIndividualPole(poleForLaneGroup.poles[i], laneGroupId, colorObject))
        }
       return results;
    }

    function processIndividualPole(pole, laneGroupId, colorObject){
        var result = [];
        if(!pole.specification_compliance || !pole.specification_compliance.compliant_with_specification_ref) {
            colorObject.c = "rgba(0,0,0,0.8)";
            colorObject.f = "rgba(112,112,112,0.3)";
        }

        result.push(createPointFeature(pole.bottom_center_point, pole.bottom_cross_section_diameter_cm, pole.id, laneGroupId, "bottom", colorObject));
        result.push(createPointFeature(pole.top_center_point, pole.top_cross_section_diameter_cm, pole.id, laneGroupId, "top", colorObject));

        return result;
    }

    function createPointFeature(poleCoordinate, diameter, id, laneGroupId, position, colorObject){
    var r = diameter/2/10   //dividing by 2 to get radius, and then 10 to get smaller value. i.e. for pole with diameter of 50cm it will be rendered with radius 2.5
    var color = colorObject.c;
    var fillColor = colorObject.f;
    var width = 1;
    if(position == "bottom") {
        color = color.replace("1.0)", "0.8)")
        fillColor = fillColor.replace("1.0)", "0.2)")
        width = 2;
    }
        var f = {
                    type : "Feature",
                    properties : {
                        pole_id: id,
                        lane_group_id: laneGroupId,
                        diameter_cm: diameter,
                        point_position: position,
                        style: {
                            color: color,
                            fill: fillColor,
                            width: width
                        },
                        radius: r
                    },
                    geometry : {
                        type : "Point",
                        coordinates : []
                    }
                };

        var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(poleCoordinate.here_2d_coordinate);
        f.geometry.coordinates.push(lonLatCoordinate[0])
        f.geometry.coordinates.push(lonLatCoordinate[1])

        return f
    }

    function updateLaneGroup(laneGroupList, laneGroupId, colorObject) {
        for(var i = 0; i < laneGroupList.length; i++) {
            if(laneGroupList[i].properties.lane_group_id == laneGroupId) {
                laneGroupList[i].properties.style.color = colorObject.c;
                laneGroupList[i].properties.style.fill = colorObject.f;
                break;
            }
        }

    }

})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.alpha.landmark.LandmarkPolesLayerTile'] = {} : exports);