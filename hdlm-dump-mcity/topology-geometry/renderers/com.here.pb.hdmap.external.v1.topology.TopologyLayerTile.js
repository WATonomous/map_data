/**
 * Plugin to convert com.here.pb.hdmap.external.v1.topology.TopologyLayerTile layers to GeoJSON.
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

        if (!data.tile_center_here_2d_coordinate) {
            logger.info("Looks like source data does not have tile center coordinate. Make sure your are passing correct data to renderer.");
            return null;
        }

        var tileCenterPoint = data.tile_center_here_2d_coordinate;

        if (!data.nodes_in_tile || !data.links_starting_in_tile) {
            logger.info("Source data does not have nodes_in_tile or links_starting_in_tile. Make sure your are passing correct data to renderer.");
            return null;
        }

        var result = {
            "type" : "FeatureCollection",
            "features" : []
        };

        // Process links that start in the tile
        result.features = result.features.concat(processLinks(data.links_starting_in_tile, tileCenterPoint));
        logger.info("Links successfully processed: " + data.links_starting_in_tile.length);

        // Process nodes in the tile.  They will be rendered on top of the links since they were added to the FeatureCollection afterwards.
        result.features = result.features.concat(processNodes(data.nodes_in_tile, tileCenterPoint));
        logger.info("Nodes successfully processed: " + data.nodes_in_tile.length);

        return {
            contentType : type,
            body : result
        };
    };

    function processNodes(nodes, tileCenterPoint){
    	var list = [];

    	for (var i = 0; i < nodes.length; i++){
    	    list.push(createNodeFeature(nodes[i], tileCenterPoint));
    	}

    	return list;
    };

    function createNodeFeature(node, tileCenterPoint){
       var f = {
            type : "Feature",
            properties : {
                id : node.node_id,
                style : {
                   color: "black",
                  width: 2
                }
            },
            geometry : {
                type : "Polygon",
                coordinates : []
            }
        };

        var hdMapCoordinate = node.geometry.here_2d_coordinate.xor(tileCenterPoint);
        var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
        var coordinates = convertCoordinateToShape(lonLatCoordinate[0], lonLatCoordinate[1]);
        var outerArray = [] // Polygons are wrapped in an outer array
        outerArray.push(coordinates);
        f.geometry.coordinates = outerArray;

        return f;
    };

     function convertCoordinateToShape(lon, lat){
        var coordinateList = [];
        var distance = 0.000025;

        // Creates rectangle from point
        coordinateList.push([lon - distance, lat + distance]);	//upper left corner
        coordinateList.push([lon + distance, lat + distance]);	//upper right corner
        coordinateList.push([lon + distance, lat - distance]);	//lover right corner
        coordinateList.push([lon - distance, lat - distance]);	//lover left corner

        return coordinateList;
     }

    function processLinks(links, tileCenterPoint){
    	var list = [];

    	for(var i = 0; i < links.length; i++){
    		if(links[i].geometry){
    			list.push(processLineStringArray(links[i].geometry.here_2d_coordinate_diffs, links[i].link_id, tileCenterPoint));
    		}
    	}

    	return list;
    };

    function processLineStringArray(here_2d_coordinate_diffs, link_id, tileCenterPoint) {
		var f = {
	        type : "Feature",
	        properties : {
	            id : link_id,
	            style : {
                	color: "blue",
                	width: 2
                }
	        },
	        geometry : {
	            type : "LineString",
	            coordinates : []
	        }
	    };

        var lastDiff = tileCenterPoint;
		for(var i = 0; i < here_2d_coordinate_diffs.length; i++){
		    var hdMapCoordinate = here_2d_coordinate_diffs[i].xor(lastDiff);
		    var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
			f.geometry.coordinates.push([lonLatCoordinate[0], lonLatCoordinate[1]]);
			lastDiff = hdMapCoordinate;
		}

		return f;
    };


})(typeof exports === 'undefined' ? this['renderer.com.here.pb.hdmap.external.v1.topology.TopologyLayerTile'] = {} : exports);
