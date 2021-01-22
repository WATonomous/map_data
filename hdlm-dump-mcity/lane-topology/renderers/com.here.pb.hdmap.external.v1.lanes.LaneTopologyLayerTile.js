/**
 * Plugin to convert com.here.pb.hdmap.external.v1.lanes.LaneTopologyLayerTile layers to GeoJSON.
 */

(function(exports) {
	"use strict";
	var path = require('path');
    var appDir = path.dirname(require.main.filename);
    var pathToModule = appDir.replace('rest','web') + "/maputils"
    var mapUtils = require(pathToModule);

	exports.loadAttributionLayer = function (logger, context) {
        logger.info("Loading attribution layer for partition " + context.partition + ", version " + context.version);
        var laneAttributesLayerMetadata = context.config['lane-attributes'];


        return context.catApi.getPartitionDecoded(laneAttributesLayerMetadata, context.partition, context.version).then(function (decodedPartitionData) {
            // Found a corresponding lane attribution meta data for the given partition
            var laneGroupAttributionData = decodedPartitionData.decoded.lane_group_attribution;
            logger.info("Received partition " + context.partition + " with " + laneGroupAttributionData.length + " lane group attributes");

            var complianceMap = new Map();	//map of lane group ids to a compliance information
            for(var i=0; i< laneGroupAttributionData.length; i++){
            	var laneGroupId = laneGroupAttributionData[i].lane_group_ref.toString();
            	var complianceInfo = [];
            	for(let paramAttribution of laneGroupAttributionData[i].parametric_attribution){	//LaneGroupAttribution.ParametricAttribution
            		for(let laneGroupParamAttr of paramAttribution.lane_group_parametric_attribution) {	//LaneGroupAttribution.ParametricAttribution.LaneGroupParametricAttribution
            			complianceInfo.push(laneGroupParamAttr.specification_compliance.compliant_with_specification_ref);
            		}
            	}

            	if(complianceInfo.length > 0){
            		complianceMap.set(laneGroupId, complianceInfo)
            	}
            }
            return complianceMap
        }, function (err) {
            logger.warn("Failed to load attribution layer", err);
            return null;
        });
    };

	exports.promiseToGeoJSON = function(logger, laneTopologyLayerMetadata, decodedPartitionData, context) {
		logger.info("Lane Topology layer conversion to GeoJSON started");

		var laneTopologyData = decodedPartitionData.decoded;
		if (!laneTopologyData.lane_groups_starting_in_tile || !laneTopologyData.lane_group_connectors_in_tile) {
            logger.info("Looks like source data does not have lane_groups_starting_in_tile or lane_group_connectors_in_tile. Make sure your are passing correct data to renderer.");
            return null;
        }

        return exports.loadAttributionLayer(logger, context).then(function(complianceMap){
            var result = {
                    "type" : "FeatureCollection",
                    "features" : []
                };

            //processing the lane_groups_starting_in_tile first
             result.features = processLaneGroups(laneTopologyData.lane_groups_starting_in_tile, laneTopologyData.tile_center_here_2d_coordinate, complianceMap);

            //then processing lane_group_connectors_in_tile
            result.features = result.features.concat(processLaneGroupConnectors(laneTopologyData.lane_group_connectors_in_tile, laneTopologyData.tile_center_here_2d_coordinate));

            logger.info("Lane Topology layer conversion to GeoJSON successfully finished");

            return {
                contentType : "application/vnd.geo+json; charset=utf-8",
                body : result
            };

        }, function(err){
        	logger.error("Failure:", err);
            return null;
        });

    };

    function processLaneGroups(laneGroups, tileCenter, complianceMap){
    	var list = [];

    	var params = {
    			tileCenter: tileCenter
    	};

        for(var i = 0; i<laneGroups.length; i++){
            if(laneGroups[i].boundary_geometry){
                params.id = laneGroups[i].lane_group_id.toString();
                params.idType = "laneGroupId";
                params.idDisplayName = "Lane Group";

                params.pointsList = laneGroups[i].boundary_geometry.left_boundary.here_2d_coordinate_diffs;
                var leftBoundary = processLinestringsArray(params)

                params.pointsList = laneGroups[i].boundary_geometry.right_boundary.here_2d_coordinate_diffs;
                var rightBoundary = processLinestringsArray(params)

                 if (complianceMap != null){
                    var laneGroupCompliance = complianceMap.get(params.id);
                     if(laneGroupCompliance) {
                        //process geometry with the HD Map compliance information
                        list.push(processLaneGroupGeometry(leftBoundary.geometry, rightBoundary.geometry, laneGroupCompliance, params.id));
                     } else{
                        //lane group has corresponding lane attribution tile but does not compliance info
                        //process as left/right boundary line strings
                        list.push(leftBoundary);
                        list.push(rightBoundary);
                     }

                 } else {
                    //geometry will be rendered as missing lane attribution and no compliance information
                    list.push(processLaneGroupGeometry(leftBoundary.geometry, rightBoundary.geometry, null, params.id));
                 }
            }
        }
        return list;
    }

    function processLaneGroupConnectors(groupConnectors, tileCenter){
    	var list = [];

    	var params = {
    			idType: "connectorId",
    			tileCenter: tileCenter,
    			style: {
    				color: "blue",
    				width: 2
                },
                idDisplayName: "Lane Connector"
    	};

    	for(var i = 0; i<groupConnectors.length; i++){
    		if(groupConnectors[i].boundary_geometry){
    			params.pointsList = groupConnectors[i].boundary_geometry.here_2d_coordinate_diffs;
    			params.id = groupConnectors[i].lane_group_connector_id.toString();
    			list.push(processLinestringsArray(params));
    		}
    	}

    	return list;
    }

    function processLinestringsArray(data) {
    	var f = {
	        type : "Feature",
	        properties : {
                tooltip: "<b>"+data.idDisplayName+" Id:</b> "+data.id
            },
	        geometry : {
	            type : "LineString",
	            coordinates : []
            }
	    };

    	f.properties[data.idType] = data.id;

		if(data.style){
			f.properties.style = data.style;
		}

		var lastDiffPoint = data.tileCenter

		for(var i=0; i<data.pointsList.length; i++){
			var hdMapCoordinate = data.pointsList[i];
			hdMapCoordinate = hdMapCoordinate.xor(lastDiffPoint);
			var lonLatCoordinate = mapUtils.hdmapCoordinateToLonLat(hdMapCoordinate);
			f.geometry.coordinates.push([lonLatCoordinate[0], lonLatCoordinate[1]])
			lastDiffPoint = hdMapCoordinate;
		}

		return f;
    };

    function processLaneGroupGeometry(leftBoundary, rightBoundary, complianceInfo, laneGroupId){
    	//default lane group colors rendered for lanes missing compliance information
    	//missing compliance information is attributed to missing corresponding lane attribution data
    	var laneGroupColor = "rgba(128,128,128,1)"
        var laneGroupFill = "rgba(128,128,128,0.7)"
        var complianceLevel;

    	if (complianceInfo){
    	    var laneGroupColor = calculateComplianceRGBColor(complianceInfo[0], 1)
            var laneGroupFill = calculateComplianceRGBColor(complianceInfo[0], 0.7)
            complianceLevel = complianceInfo[0];
    	}

    	var f = {
    	        type : "Feature",
    	        properties : {
    	        	laneGroupId: laneGroupId,
    	        	compliantWithSpecificationRef : complianceInfo,
    	        	style: {
    	        		fill: laneGroupFill,
    	        		color: laneGroupColor
                    },
                    tooltip: "<b>Lane Group Id:</b> "+laneGroupId
                            + (typeof complianceLevel !== 'undefined' ? "<br><b>Compliance Level: </b>"+complianceLevel: "")
    	        },
    	        geometry : {
    	            type : "Polygon",
    	            coordinates : []
    	        }
    	    };

    	var tempArr = [];
    	tempArr = leftBoundary.coordinates;				//adding left boundary coordinates as is
    	tempArr = tempArr.concat(rightBoundary.coordinates.reverse());	//reversing right boundary coordinates and adding them
        tempArr.push(leftBoundary.coordinates[0]);				//adding the first coordinate of left boundary to close the loop of coordinates and form proper polygon

        var outerArray = [] // Polygons are wrapped in an outer array
        outerArray.push(tempArr);
        f.geometry.coordinates = outerArray;

        return f;
    }

    function calculateComplianceRGBColor(complianceSpecification, opacity) {
        // Bright green color (rgb(50,255,50)) is taken as a base and its 'G' part is changing
        // depending on the compliance specification value based making it darker.
        var rgbColor = "";
        switch(complianceSpecification){
            case 1: rgbColor = "50,255,50"; break;
            case 2: rgbColor = "17,147,19"; break;
            case 3: rgbColor = "2,68,5"; break;
            default: rgbColor = "1,25,2"; opacity = opacity - 0.4; //if a new specification id is added, default it to semi-transparent dark green
        }
        return "rgba(" + rgbColor + "," + opacity +")";

    }

})(typeof exports === 'undefined' ? this['renderer.com.here.pb.hdmap.external.v1.lanes.LaneTopologyLayerTile'] = {} : exports);