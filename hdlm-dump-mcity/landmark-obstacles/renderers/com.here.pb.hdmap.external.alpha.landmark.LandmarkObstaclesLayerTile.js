/**
 * Plugin to convert com.here.pb.hdmap.external.alpha.LandmarkObstaclesLayerTile layers to GeoJSON.
 */
(function(exports) {
	"use strict";
	var path = require('path');
	var appDir = path.dirname(require.main.filename);
	var pathToModule = appDir.replace('rest','web') + "/maputils"
	var mapUtils = require(pathToModule);

	exports.toGeoJSON = function(logger, layer, decodeResult) {
        var type = "application/vnd.geo+json; charset=utf-8";
        var data = decodeResult.decoded;


        if (!data.here_tile_id || !data.obstacles_for_lane_groups) {
         logger.info("Source data is missing tile id or obstacles for lane groups");
        }

        var result = {
            "type" : "FeatureCollection",
            "features" : []
        };

        result.features =  processObstaclesForLaneGroup(data.obstacles_for_lane_groups, data.tile_center_here_2d_coordinate);

		logger.info("Finished processing geo json");

		return {
			contentType : type,
			body : result
        };

     }

    // Process all obstacles for a single lane group
    function processObstaclesForLaneGroup(laneGroupObstacles, centralPoint){
        var results = [];

        for(var i = 0; i<laneGroupObstacles.length; i++){
            // Process all obstacles for the given lane group
            results = results.concat(processObstacles(laneGroupObstacles[i].obstacles, centralPoint))
        }
        return results;
    }

    function processObstacles(obstacles, centralPoint){
        var results = [];
        var compliantColors = ["green", "blue", "purple"]
		var nonCompliantColors = ["RGB(50, 50, 50)", "RGB(100, 100, 100)", "RGB(150, 150, 150)"]


        for(var i = 0; i<obstacles.length; i++){
            // Process each obstacle in the list
			var color = i % 3
			var compliance = (obstacles[i].specification_compliance) ? true : false;

			var obstacleColor = "";
			if (compliance){
				obstacleColor = compliantColors[color];
			}else{
				obstacleColor = nonCompliantColors[color];
			}

			results.push(processIndividualObstacle(obstacles[i], centralPoint, obstacleColor, compliance))
        }
        return results;
    }


    function processIndividualObstacle(obstacle, centralPoint, color, compliance){
         var f = {
            type : "Feature",
            properties : {
				id: obstacle.id,
                style: {
                    color: color
                }
            },
            geometry : {
                type : "LineString",
                coordinates : []
            }
        };

        if(compliance){
            f.properties.compliance = obstacle.specification_compliance.compliant_with_specification_ref;
        }

        var lastDiff = centralPoint;
        var coordinates = obstacle.geometry.here_2d_coordinate_diffs
        for(var i=0; i<coordinates.length; i++){
            var hdMapCoordinate = coordinates[i].xor(lastDiff);
            var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
            f.geometry.coordinates.push([lonLatCoordinate[0], lonLatCoordinate[1]])
            lastDiff = hdMapCoordinate;
        }

        return f;
     }

})(typeof exports === 'undefined' ? this['renderer.com.here.pb.hdmap.external.alpha.LandmarkObstaclesLayerTile'] = {} : exports);