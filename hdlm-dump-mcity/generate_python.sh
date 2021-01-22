# Note: must have proto3 installed, script must be called from hdlm-dump-mcity directory

protoc -I./external-reference-attributes external-reference-attributes/com/here/pb/hdmap/external/v1/reference/layer-external-reference-attributes.proto --python_out=./
protoc -I./external-reference-attributes external-reference-attributes/com/here/pb/hdmap/external/v1/common/common.proto --python_out=./
protoc  -I./external-reference-attributes external-reference-attributes/com/here/pb/hdmap/platform/v1/common/common.proto --python_out=./
protoc -I./external-reference-attributes external-reference-attributes/com/here/pb/hdmap/shared/v1/core/common.proto --python_out=./
protoc -I./external-reference-attributes external-reference-attributes/com/here/pb/hdmap/shared/v1/core/unconditional_attributes.proto --python_out=./

protoc -I./lane-attributes lane-attributes/com/here/pb/hdmap/external/v1/lanes/layer-lane-attributes.proto --python_out=./
protoc -I./lane-attributes lane-attributes/com/here/pb/hdmap/external/v1/common/common.proto --python_out=./
protoc -I./lane-attributes lane-attributes/com/here/pb/hdmap/platform/v1/common/common.proto --python_out=./
protoc -I./lane-attributes lane-attributes/com/here/pb/hdmap/shared/v1/lanes/lanes.proto --python_out=./
protoc -I./lane-attributes lane-attributes/com/here/pb/hdmap/shared/v1/lanes/lanes.proto --python_out=./

protoc -I./lane-geometry-polyline lane-geometry-polyline/com/here/pb/hdmap/external/v1/lanes/layer-lane-geometry-polyline.proto --python_out=./
protoc -I./lane-geometry-polyline lane-geometry-polyline/com/here/pb/hdmap/external/v1/geometry/geometry.proto --python_out=./

protoc -I./lane-road-references lane-road-references/com/here/pb/hdmap/external/v1/lanes/layer-lane-road-reference.proto --python_out=./
protoc -I./lane-road-references lane-road-references/com/here/pb/hdmap/external/v1/common/common.proto --python_out=./

protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/external/v1/routing/layer-routing-attributes.proto --python_out=./
protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/external/v1/common/common.proto --python_out=./
protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/shared/v1/core/common.proto --python_out=./
protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/shared/v1/core/conditional_attribute_modifiers.proto --python_out=./
protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/shared/v1/core/conditional_attributes.proto --python_out=./
protoc -I./routing-attributes routing-attributes/com/here/pb/hdmap/shared/v1/core/unconditional_attributes.proto --python_out=./

protoc -I./routing-lane-attributes routing-lane-attributes/com/here/pb/hdmap/external/v1/routinglane/layer-routing-lane-attributes.proto --python_out=./

protoc -I./speed-attributes speed-attributes/com/here/pb/hdmap/external/v1/speed/layer-speed-attributes.proto --python_out=./

protoc -I./topology-geometry topology-geometry/com/here/pb/hdmap/external/v1/topology/layer-topology-geometry.proto --python_out=./


