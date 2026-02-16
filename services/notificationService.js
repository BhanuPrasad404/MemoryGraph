// backend/services/notificationService.js
const supabase = require('./supabaseService').supabase;

class NotificationService {
    async create(userId, type, title, message, documentId = null) {
        try {
            const { error } = await supabase
                .from('notifications')
                .insert({
                    user_id: userId,
                    type,
                    title,
                    message,
                    document_id: documentId,
                    created_at: new Date().toISOString()
                });

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Notification failed:', error);
            return false;
        }
    }

    // Specific methods for your app
    async documentProcessed(userId, documentId, filename) {
        return this.create(
            userId,
            'success',
            '✅ Document Ready',
            `"${filename}" is now searchable`,
            documentId
        );
    }

    async documentFailed(userId, filename, error) {
        return this.create(
            userId,
            'error',
            '❌ Processing Failed',
            `"${filename}" failed: ${error}`,
            null
        );
    }
}

module.exports = new NotificationService(); 