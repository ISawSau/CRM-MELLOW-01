# Puente JNI que arranca el Node de nodejs-mobile (D-101).
cmake_minimum_required(VERSION 3.22)
project(crmnode CXX)

set(LIBNODE ${CMAKE_SOURCE_DIR}/../../../libnode)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION ${LIBNODE}/jniLibs/${ANDROID_ABI}/libnode.so)

add_library(crmnode SHARED node-runner.cpp)
target_include_directories(crmnode PRIVATE ${LIBNODE}/include/node)
target_link_libraries(crmnode node log)
