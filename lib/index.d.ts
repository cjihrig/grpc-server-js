/// <reference types="node" />
import * as http2 from 'http2';
import { Duplex, Readable, Writable } from 'stream';


export interface Serialize<T> {
  (value: T): Buffer;
}

export interface Deserialize<T> {
  (bytes: Buffer): T;
}

export interface MethodDefinition<RequestType, ResponseType> {
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  requestSerialize: Serialize<RequestType>;
  responseSerialize: Serialize<ResponseType>;
  requestDeserialize: Deserialize<RequestType>;
  responseDeserialize: Deserialize<ResponseType>;
  originalName?: string;
}

export interface ServiceDefinition {
  [index: string]: MethodDefinition<object, object>;
}


export declare type KeyCertPair = {
  private_key: Buffer;
  cert_chain: Buffer;
};

export declare abstract class ServerCredentials {
  abstract _isSecure(): boolean;
  abstract _getSettings(): http2.SecureServerOptions | null;
  static createInsecure(): ServerCredentials;
  static createSsl(rootCerts: Buffer | null,
                   keyCertPairs: KeyCertPair[],
                   checkClientCertificate?: boolean): ServerCredentials;
}


export interface MetadataOptions {
  // Signal that the request is idempotent. Defaults to false.
  idempotentRequest?: boolean;
  // Signal that the call should not return UNAVAILABLE before it has started.
  // Defaults to true.
  waitForReady?: boolean;
  // Signal that the call is cacheable. gRPC is free to use the GET verb.
  // Defaults to false.
  cacheableRequest?: boolean;
  // Signal that the initial metadata should be corked. Defaults to false.
  corked?: boolean;
}

export declare type MetadataValue = string | Buffer;
export declare type MetadataObject = Map<string, MetadataValue[]>;
export declare class Metadata {
  protected internalRepr: MetadataObject;
  private options: MetadataOptions;
  constructor(options?: MetadataOptions) {}
  set(key: string, value: MetadataValue): void;
  add(key: string, value: MetadataValue): void;
  remove(key: string): void;
  get(key: string): MetadataValue[];
  getMap(): { [key: string]: MetadataValue; };
  clone(): Metadata;
  merge(other: Metadata): void;
  toHttp2Headers(): http2.OutgoingHttpHeaders;
  setOptions(options: MetadataOptions): void;
  getOptions(): MetadataOptions;
  static fromHttp2Headers(headers: http2.IncomingHttpHeaders): Metadata;
}


export declare enum LogVerbosity {
  DEBUG = 0,
  INFO = 1,
  ERROR = 2
}

export declare const setLogger: (logger: Partial<Console>) => void;
export declare const setLogVerbosity: (verbosity: LogVerbosity) => void;


export declare enum Status {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16
}

export interface StatusObject {
  code: Status;
  details: string;
  metadata: Metadata;
}

export declare type ServiceError = StatusObject & Error;
export declare type ServerStatusResponse = Partial<StatusObject>;
export declare type ServerErrorResponse = ServerStatusResponse & Error;


declare type ServerSurfaceCall = {
  cancelled: boolean;
  getPeer(): string;
  sendMetadata(responseMetadata: Metadata): void;
};
export declare type ServerUnaryCall<RequestType, ResponseType> =
    ServerSurfaceCall & { request: RequestType | null; };
export declare type ServerReadableStream<RequestType, ResponseType> =
    ServerSurfaceCall & Readable;
export declare type ServerWritableStream<RequestType, ResponseType> =
    ServerSurfaceCall & Writable & { request: RequestType | null; };
export declare type ServerDuplexStream<RequestType, ResponseType> =
    ServerSurfaceCall & Duplex;


export declare type sendUnaryData<ResponseType> =
    (error: ServerErrorResponse | ServerStatusResponse | null,
     value: ResponseType | null,
     trailer?: Metadata,
     flags?: number) => void;
export declare type handleUnaryCall<RequestType, ResponseType> =
    (call: ServerUnaryCall<RequestType, ResponseType>,
     callback: sendUnaryData<ResponseType>) => void;
export declare type handleClientStreamingCall<RequestType, ResponseType> =
    (call: ServerReadableStream<RequestType, ResponseType>,
     callback: sendUnaryData<ResponseType>) => void;
export declare type handleServerStreamingCall<RequestType, ResponseType> =
    (call: ServerWritableStream<RequestType, ResponseType>) => void;
export declare type handleBidiStreamingCall<RequestType, ResponseType> =
    (call: ServerDuplexStream<RequestType, ResponseType>) => void;


export declare type HandleCall<RequestType, ResponseType> =
    handleUnaryCall<RequestType, ResponseType> |
    handleClientStreamingCall<RequestType, ResponseType> |
    handleServerStreamingCall<RequestType, ResponseType> |
    handleBidiStreamingCall<RequestType, ResponseType>;


export declare type UntypedHandleCall = HandleCall<any, any>;
export interface UntypedServiceImplementation {
  [name: string]: UntypedHandleCall;
}


export interface ChannelOptions {
  'grpc.http2.max_frame_size'?: string;
  'grpc.ssl_target_name_override'?: string;
  'grpc.primary_user_agent'?: string;
  'grpc.secondary_user_agent'?: string;
  'grpc.default_authority'?: string;
  'grpc.keepalive_time_ms'?: number;
  'grpc.keepalive_timeout_ms'?: number;
  'grpc.service_config'?: string;
  'grpc.max_concurrent_streams'?: number;
  'grpc.initial_reconnect_backoff_ms'?: number;
  'grpc.max_reconnect_backoff_ms'?: number;
  'grpc.use_local_subchannel_pool'?: number;
  [key: string]: string | number | undefined;
}


export declare class Server {
  constructor(options?: ChannelOptions);
  addProtoService(): void;
  addService(service: ServiceDefinition,
             implementation: UntypedServiceImplementation): void;
  bind(port: string, creds: ServerCredentials): Promise<void>;
  bindAsync(port: string,
            creds: ServerCredentials,
            callback: (error: Error | null, port: number) => void): void;
  forceShutdown(): void;
  register<RequestType, ResponseType>(
    name: string,
    handler: HandleCall<RequestType, ResponseType>,
    serialize: Serialize<ResponseType>,
    deserialize: Deserialize<RequestType>,
    type: string
  ): boolean;
  start(): void;
  tryShutdown(callback: (error?: Error) => void): void;
  addHttp2Port(): void;
}

export {
  LogVerbosity as logVerbosity,
  Status as status
};
