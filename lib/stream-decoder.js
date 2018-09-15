'use strict';
const EventEmitter = require('events');


const ReadState = {
  NO_DATA: 1,
  READING_SIZE: 2,
  READING_MESSAGE: 3
};


class StreamDecoder extends EventEmitter {
  constructor () {
    super();
    this.readState = ReadState.NO_DATA;
    this.readCompressFlag = Buffer.alloc(1);
    this.readPartialSize = Buffer.alloc(4);
    this.readSizeRemaining = 4;
    this.readMessageSize = 0;
    this.readMessageRemaining = 0;
    this.readPartialMessage = [];
  }

  write (data) {
    let readHead = 0;
    let toRead;

    while (readHead < data.length) {
      switch (this.readState) {
        case ReadState.NO_DATA :
          this.readCompressFlag = data.slice(readHead, readHead + 1);
          readHead += 1;
          this.readState = ReadState.READING_SIZE;
          this.readPartialSize.fill(0);
          this.readSizeRemaining = 4;
          this.readMessageSize = 0;
          this.readMessageRemaining = 0;
          this.readPartialMessage = [];
          break;
        case ReadState.READING_SIZE :
          toRead = Math.min(data.length - readHead, this.readSizeRemaining);
          data.copy(
            this.readPartialSize, 4 - this.readSizeRemaining, readHead,
            readHead + toRead);
          this.readSizeRemaining -= toRead;
          readHead += toRead;
          // readSizeRemaining >=0 here
          if (this.readSizeRemaining === 0) {
            this.readMessageSize = this.readPartialSize.readUInt32BE(0);
            this.readMessageRemaining = this.readMessageSize;
            if (this.readMessageRemaining > 0) {
              this.readState = ReadState.READING_MESSAGE;
            } else {
              this.emit('message', Buffer.concat(
                [this.readCompressFlag, this.readPartialSize]));
              this.readState = ReadState.NO_DATA;
            }
          }
          break;
        case ReadState.READING_MESSAGE :
          toRead =
              Math.min(data.length - readHead, this.readMessageRemaining);
          this.readPartialMessage.push(
            data.slice(readHead, readHead + toRead));
          this.readMessageRemaining -= toRead;
          readHead += toRead;
          // readMessageRemaining >=0 here
          if (this.readMessageRemaining === 0) {
            // At this point, we have read a full message
            const framedMessageBuffers = [
              this.readCompressFlag, this.readPartialSize
            ].concat(this.readPartialMessage);
            const framedMessage = Buffer.concat(
              framedMessageBuffers, this.readMessageSize + 5);
            this.emit('message', framedMessage);
            this.readState = ReadState.NO_DATA;
          }
          break;
        default :
          throw new Error('Unexpected read state');
      }
    }
  }
}

module.exports = { StreamDecoder };
