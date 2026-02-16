let ioInstance = null;

function initIO(io) {
    ioInstance = io;
    return ioInstance;
}

function getIO() {
    if (!ioInstance) {
        throw new Error('Socket.IO not initialized');
    }
    return ioInstance;
}

module.exports = { initIO, getIO };
