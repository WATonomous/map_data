
Dump contents of protobuf tile in textual format :
protoc.exe -I.\ --decode=com.here.pb.hdmap.external.v1.adas.AdasAttributesLayerTile com\here\pb\hdmap\external\v1\adas\layer-adas-attributes.proto < 321618294 > 321618294.txt

Generate C++ code to read protobuf tiles :
protoc.exe -I.\ com\here\pb\hdmap\external\v1\adas\layer-adas-attributes.proto --cpp_out=cpp

