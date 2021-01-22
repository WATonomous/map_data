/**
 * Plugin to convert com.here.pb.hdmap.external.v1.lanes.LaneGeometryPolylineLayerTile layers to GeoJSON.
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

        if (!data.tile_center_here_3d_coordinate || !data.tile_center_here_3d_coordinate.here_2d_coordinate) {
            logger.info("Looks like source data does not have tile center coordinate. Make sure your are passing correct data to renderer.");
            return null;
        }
        
        if(!data.lane_group_geometries){
        	logger.info("Looks like source data does not have lane_group_geometries. Make sure your are passing correct data to renderer.");
            return null;
        }

        var result = {
            "type" : "FeatureCollection",
            "features" : []
        };

        result.features = processLaneBoundaryGeometries(data.lane_group_geometries, data.tile_center_here_3d_coordinate.here_2d_coordinate);
        
        result.features = result.features.concat(processLaneGeometries(data.lane_group_geometries, data.tile_center_here_3d_coordinate.here_2d_coordinate));
        
        result.features = result.features.concat(processReferenceGeometry(data.lane_group_geometries, data.tile_center_here_3d_coordinate.here_2d_coordinate));
        
        logger.info("Lane geometry succesffully converted into GeoJSON"); 
        
        return {
            contentType : type,
            body : result
        };
    };
    
    function processLaneBoundaryGeometries(data, centralPoint){
    	var results = [];
    	for(var i = 0; i<data.length; i++){
    		results = results.concat(processIndividualLaneBoundaryGeometries(data[i].lane_boundary_geometries, centralPoint))
    	}
    	return results;
    }
    
    function processIndividualLaneBoundaryGeometries(data, centralPoint){
    	var results = [];
    	for(var i = 0; i<data.length; i++){
    		results.push(convertCoordinateDiffsToGeoFeature(data[i].geometry.here_2d_coordinate_diffs, centralPoint));
    	}
    	return results;
    }
    
    function processLaneGeometries(data, centralPoint){
    	var results = [];
    	for(var i = 0; i<data.length; i++){
    		results = results.concat(processIndividualLanePathGeometry(data[i].lane_geometries, centralPoint))
    	}
    	return results;
    }
    
    function processIndividualLanePathGeometry(data, centralPoint){
    	var results = [];
    	var style = {
    			color: "gray"
        	};
    	for(var i = 0; i<data.length; i++){
    		results.push(convertCoordinateDiffsToGeoFeature(data[i].lane_path_geometry.here_2d_coordinate_diffs, centralPoint, style));
    	}
    	return results;
    }
    
    function processReferenceGeometry(data, centralPoint){
    	var results = [];
    	var style = {
    			color: "rgba(51,51,255,0.2)",
    			width: 6
        	};
    	for(var i = 0; i<data.length; i++){
    		results.push(convertCoordinateDiffsToGeoFeature(data[i].reference_geometry.here_2d_coordinate_diffs, centralPoint,style))
    	}
    	return results;
    }
    
    //common function to convert here_2d_coordinate_diffs node in lane_boundary_geometries.geometry,  lane_geometries.lane_path_geometry and reference_geometry to a GeoJson Feature
    function convertCoordinateDiffsToGeoFeature(coordinates, centralPoint, style){
    	var f = {
    	        type : "Feature",
    	        properties : {},
    	        geometry : {
    	            type : "LineString",
    	            coordinates : []
    	        }
    	    };
    		
    		if(style){
    			f.properties.style = style;
    		}
    		
    		var lastDiff = centralPoint;
    		for(var i=0; i<coordinates.length; i++){
    			var hdMapCoordinate = coordinates[i].xor(lastDiff);
    			var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
    			f.geometry.coordinates.push([lonLatCoordinate[0], lonLatCoordinate[1]])
    			lastDiff = hdMapCoordinate;
    		}
    		
    		return f;
    }

})(typeof exports === 'undefined' ? this['renderer.com.here.pb.hdmap.platform.v1.lanes.LaneTopologyLayerTile'] = {} : exports);
