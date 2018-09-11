'use strict';
const Grpc = require('@grpc/grpc-js');
const Loader = require('@grpc/proto-loader');
const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};


function loadProtoFile (file) {
  const packageDefinition = Loader.loadSync(file, protoLoaderOptions);
  const pkg = Grpc.loadPackageDefinition(packageDefinition);

  return pkg;
}


module.exports = { loadProtoFile };
