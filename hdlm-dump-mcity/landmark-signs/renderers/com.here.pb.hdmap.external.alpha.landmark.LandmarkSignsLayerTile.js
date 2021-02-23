/**
 * Plugin to convert com.here.pb.hdmap.external.alpha.landmark.LandmarkSignsLayerTile layers to GeoJSON.
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

        if (!data.here_tile_id || (!data.sign_faces && !data.rectangular_sign_boards)) {
            logger.info("Source data does not have either here_tile_id or sign_faces list. Make sure your are passing correct data to renderer.");
            return null;
        }

        var result = {
            "type" : "FeatureCollection",
            "features" : []
        };

        if (data.sign_faces){
            for(var i = 0; i < data.sign_faces.length; i++){
              	result.features.push(processIndividualSignFace(data.sign_faces[i]));
            }
        }

        /*if (data.rectangular_sign_boards){
            for(var i = 0; i < data.rectangular_sign_boards.length; i++){
                result.features.push(processIndividualSignBoard(data.rectangular_sign_boards[i]))
            }
        }*/

        logger.info("Sign faces converted to GeoJson successfully");
        
        return {
            contentType : type,
            body : result
        };
    };


    function processIndividualSignFace(signFace){
    	var f = {
    	        type : "Feature",
    	        properties : {
    	            signFaceId : signFace.id,
    	            interiorShape : translateShapeEnum(signFace.shape),
    	            heading : signFace.heading,
                    style : {
                        color: determineFeatureColor(signFace.shape),
                        width: 3
                     }
    	        },
    	        geometry : {
    	            type : determineFeatureType(signFace.shape),
    	            coordinates : []
    	        }
    	    };

            // Only set classification info if it exists
    	    if (signFace.classification){
//                Disabled as no ID is expected initially
//                f.properties.classificationId = signFace.classification.id;
    	        f.properties.classification = signFace.classification.classification;
    	    }

    	var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(signFace.center_point.here_2d_coordinate);
        var coordinates = convertCoordinateToShape(lonLatCoordinate[0], lonLatCoordinate[1], signFace.shape);
    		if (determineFeatureType(signFace.shape) == "Polygon"){
    		    var outerArray = [] // Polygons are wrapped in an outer array
				    outerArray.push(coordinates);
				    coordinates = outerArray;
    		}
    		f.geometry.coordinates = coordinates;
    		return f;
    };

    function processIndividualSignBoard(signBoard){
        var feature = {
            type: "Feature",
            properties : {
                signBoardId : signBoard.id,
                heading : signBoard.heading,
                style : {
                    color : "orange",
                    width : 3
                },
                height : signBoard.height_cm,
                width : signBoard.width_cm
            },
            geometry : {
                type : "Polygon",
                coordinates : []
            }
        };

        // Conforming to new GeoJSON spec
        var coordinates = convertCoordinateToRectangularSignBoardPolygon(signBoard);
        var outerArray = [] // Polygons are wrapped in an outer array
        outerArray.push(coordinates);
        coordinates = outerArray;

        feature.geometry.coordinates = coordinates;
        return feature;

    };

    function translateShapeEnum(shape) {
        if (shape == 1) {
            return "RECTANGULAR";
        }
        else if (shape == 2) {
            return "CIRCULAR";
        }
        else if (shape == 3) {
            return "TRIANGULAR";
        }
        else if (shape == 4) {
            return "DIAMOND";
        }
        else if (shape == 5) {
            return "OTHER";
        }
        else {
            return "UNKNOWN";
        }
    }

    function determineFeatureColor(shape){
        if (shape == 0) {
            return "red";
        }
        else {
            return "blue";
        }
    }

    function determineFeatureType(shape){
        // For unknown shapes, draw an X
    	if(shape == 0 || shape == 5) {
    		return "MultiLineString";
    	}
        // For everything else, draw a polygon
    	else {
    		return "Polygon";
    	}
    };

    function convertCoordinateToRectangularSignBoardPolygon(signBoard){
        var centerPointCoordinates = [];
        var coordinateList = [];

        // Calculate center point based on top right and bottom left corner points
        var topRightLonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(signBoard.top_right_corner_point.here_2d_coordinate);
        var bottomLeftLonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(signBoard.bottom_left_corner_point.here_2d_coordinate);

        centerPointCoordinates[0] = (topRightLonLatCoordinate[0] + bottomLeftLonLatCoordinate[0]) / 2;
        centerPointCoordinates[1] = (topRightLonLatCoordinate[1] + bottomLeftLonLatCoordinate[1]) / 2;

        // Use sign face logic for rectangle board rendering
        var lonDistance = 0.000033;
        var latDistance = 0.000017;

        coordinateList.push([centerPointCoordinates[0] - lonDistance, centerPointCoordinates[1] + latDistance]);	//upper left corner
        coordinateList.push([centerPointCoordinates[0] + lonDistance, centerPointCoordinates[1] + latDistance]);	//upper right corner
        coordinateList.push([centerPointCoordinates[0] + lonDistance, centerPointCoordinates[1] - latDistance]);	//lower right corner
        coordinateList.push([centerPointCoordinates[0] - lonDistance, centerPointCoordinates[1] - latDistance]);	//lower left corner

        return coordinateList;
    };

    function convertCoordinateToShape(lon, lat, shape){
    	var coordinateList = [];
    	var distance = 0.000025;

        // Rectangular
        if(shape == 1) {
            coordinateList.push([lon - distance, lat + distance]);	//upper left corner
            coordinateList.push([lon + distance, lat + distance]);	//upper right corner
            coordinateList.push([lon + distance, lat - distance]);	//lower right corner
            coordinateList.push([lon - distance, lat - distance]);	//lower left corner
        }
        // Circle
        else if (shape == 2) {
            convertShapeToCircle(lon, lat, coordinateList);
         }
        // Triangular
        else if (shape == 3) {
            coordinateList.push([lon, lat + distance]);	//top point
            coordinateList.push([lon - distance, lat - distance]);	//lower left point
            coordinateList.push([lon + distance, lat - distance]);	//lower right point
        }
        // Diamond
        else if (shape == 4) {
            var diamondDistance = Math.sqrt(Math.pow(distance,2) * 2);
            coordinateList.push([lon, lat + diamondDistance]); // top point
            coordinateList.push([lon + diamondDistance, lat]); // right point
            coordinateList.push([lon, lat - diamondDistance]); // bottom point
            coordinateList.push([lon - diamondDistance, lat]); // left point
        }
        // Everything else, an X
        else {
            var line1 = [];
            var line2 = [];

            line1.push([lon - distance, lat + distance]);	//top left point
            line1.push([lon + distance, lat - distance]);	//bottom right point

            line2.push([lon + distance, lat + distance]);	//right top point
            line2.push([lon - distance, lat - distance]);	//bottom left point

            coordinateList.push(line1);
            coordinateList.push(line2);
        }

    	return coordinateList;
    }

    // Ported from http://www.ioncannon.net/gis/32/approximating-a-circle-with-a-polygon/
    function convertShapeToCircle (lon, lat, coordinateList) {
        var d2r = Math.PI / 180;   // degrees to radians
        var r2d = 180 / Math.PI;   // radians to degrees
        var earthRadius = 3963; // 3963 is the radius of the earth in miles

        var points = 16; // This can be adjusted if performance is good/bad.  Might need to parameterize this in the future to support a stop sign (8 points).
        var radius = .002;       // radius in miles

        // find the radius in lat/lon
        var rlat = (radius / earthRadius) * r2d;
        var rlon = rlat / Math.cos(lat * d2r);

        for (var i=0; i < points+1; i++) // one extra here makes sure we connect the
        {
          var theta = Math.PI * (i / (points/2));
          var ex = lon + (rlon * Math.cos(theta)); // center a + radius x * cos(theta)
          var ey = lat + (rlat * Math.sin(theta)); // center b + radius y * sin(theta)
          coordinateList.push([ex, ey]);
        }
    }


})(typeof exports === 'undefined' ? this['com.here.pb.hdmap.external.v1.landmark.LandmarkSignsLayerTile'] = {} : exports);
