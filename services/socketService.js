// Get io from app (we set it in server.js)
const { getIO } = require('../socket/io');

class SocketService {
    emitToUser(userId, event, data) {
        const io = getIO();
        io.to(`user-${userId}`).emit(event, data);
    }

    emitToDocument(documentId, event, data) {
        const io = getIO();
        io.to(`document-${documentId}`).emit(event, data);
    }
}

module.exports = new SocketService();