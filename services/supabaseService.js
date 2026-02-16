// services/supabaseService.js
const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
require('dotenv').config();

class SupabaseService {
    constructor() {
        try {
            // Initialize Supabase client
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
            );

            this.bucketName = 'documents';
            logger.info('SupabaseService initialized');
        } catch (error) {
            logger.error('Failed to initialize Supabase:', error);
            throw error;
        }
    }

    // ========== STORAGE OPERATIONS ==========

    async uploadFile(fileBuffer, filename, userId) {
        try {
            const filePath = `${userId}/${Date.now()}_${filename}`;
            const { data, error } = await this.supabase.storage
                .from(this.bucketName)
                .upload(filePath, fileBuffer, {
                    contentType: this.getContentType(filename),
                    upsert: false
                });
            if (error) throw error;

            const { data: { publicUrl } } = this.supabase.storage
                .from(this.bucketName)
                .getPublicUrl(filePath);

            logger.info(`File uploaded: ${filename} -> ${publicUrl}`);
            return publicUrl;
        } catch (error) {
            logger.error('Upload file error:', error);
            throw new Error(`File upload failed: ${error.message}`);
        }
    }

    async deleteFile(filename, userId) {
        try {
            const { data: files, error: listError } = await this.supabase.storage
                .from(this.bucketName)
                .list(userId);
            if (listError) throw listError;

            const fileToDelete = files.find(f => f.name.includes(filename));
            if (!fileToDelete) {
                logger.warn(`File not found for deletion: ${filename}`);
                return;
            }

            const filePath = `${userId}/${fileToDelete.name}`;
            const { error } = await this.supabase.storage
                .from(this.bucketName)
                .remove([filePath]);
            if (error) throw error;

            logger.info(`File deleted: ${filePath}`);
        } catch (error) {
            logger.error('Delete file error:', error);
            throw error;
        }
    }

    // ========== DATABASE OPERATIONS ==========

    async createDocument(documentData) {
        try {
            const { data, error } = await this.supabase
                .from('documents')
                .insert([{
                    filename: documentData.filename,
                    user_id: documentData.user_id,
                    file_url: documentData.file_url,
                    status: documentData.status || 'processing',
                    file_size: documentData.file_size,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();
            if (error) throw error;

            logger.info(`Document created: ${data.id} - ${data.filename}`);
            return data;
        } catch (error) {
            logger.error('Create document error:', error);
            throw error;
        }
    }

    async updateDocument(documentId, updates) {
        try {
            const { data, error } = await this.supabase
                .from('documents')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', documentId)
                .select()
                .single();
            if (error) throw error;

            logger.info(`Document updated: ${documentId}`);
            return data;
        } catch (error) {
            logger.error('Update document error:', error);
            throw error;
        }
    }

    async getDocument(documentId) {
        try {
            const { data, error } = await this.supabase
                .from('documents')
                .select('*')
                .eq('id', documentId)
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Get document error:', error);
            throw error;
        }
    }

    // Pagination added for performance
    async getUserDocuments({ userId, limit = 50, offset = 0 }) {
        try {
            // 1 Fetch paginated documents

            if (!userId || userId === 'demo-user-123') {
                logger.info('Demo user - returning empty documents list');
                return { documents: [], total: 0 }; // ← FIXED!
            }

            const { data, error } = await this.supabase
                .from('documents')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;

            //  Fetch total count (NO LIMIT / OFFSET)
            const { count, error: countError } = await this.supabase
                .from('documents')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (countError) throw countError;

            return {
                documents: data || [],
                total: count
            };

        } catch (error) {
            logger.error('Get user documents error:', error);
            throw error;
        }
    }

    async deleteDocument(documentId) {
        try {
            // Delete chunks first
            await this.supabase
                .from('chunks')
                .delete()
                .eq('document_id', documentId);

            // Delete document
            const { error } = await this.supabase
                .from('documents')
                .delete()
                .eq('id', documentId);
            if (error) throw error;

            logger.info(`Document deleted: ${documentId}`);
        } catch (error) {
            logger.error('Delete document error:', error);
            throw error;
        }
    }

    // ========== CHUNK OPERATIONS ==========

    async createChunk(chunkData) {
        try {
            const { data, error } = await this.supabase
                .from('chunks')
                .insert([{
                    document_id: chunkData.document_id,
                    content: chunkData.content,
                    chunk_index: chunkData.chunk_index,
                    vector_id: chunkData.vector_id,
                    start_char: chunkData.start_char,
                    end_char: chunkData.end_char,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Create chunk error:', error);
            throw error;
        }
    }

    // **Batch insert chunks** for performance
    async createChunks(chunksData) {
        try {
            const { data, error } = await this.supabase
                .from('chunks')
                .insert(chunksData)
                .select();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Create chunks batch error:', error);
            throw error;
        }
    }

    async getDocumentChunks(documentId) {
        try {
            const { data, error } = await this.supabase
                .from('chunks')
                .select('*')
                .eq('document_id', documentId)
                .order('chunk_index', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (error) {
            logger.error('Get document chunks error:', error);
            throw error;
        }
    }

    async getChunkByVectorId(vectorId) {
        try {
            const { data, error } = await this.supabase
                .from('chunks')
                .select('*')
                .eq('vector_id', vectorId)
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Get chunk by vector ID error:', error);
            throw error;
        }
    }

    // ========== GRAPH OPERATIONS =========

    async createGraphNode(nodeData) {
        try {
            const { data, error } = await this.supabase
                .from('graph_nodes')
                .insert([{
                    document_id: nodeData.document_id,
                    name: nodeData.name,
                    type: nodeData.type || 'concept',
                    metadata: nodeData.metadata || {},
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Create graph node error:', error);
            throw error;
        }
    }

    async createGraphEdge(edgeData) {
        try {
            const { data, error } = await this.supabase
                .from('graph_edges')
                .insert([{
                    source_node: edgeData.source_node,
                    target_node: edgeData.target_node,
                    relationship: edgeData.relationship,
                    weight: edgeData.weight || 1.0,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Create graph edge error:', error);
            throw error;
        }
    }

    async getDocumentGraph(documentId) {
        try {
            const { data: nodes, error: nodesError } = await this.supabase
                .from('graph_nodes')
                .select('*')
                .eq('document_id', documentId);
            if (nodesError) throw nodesError;

            if (!nodes || nodes.length === 0) return { nodes: [], edges: [] };

            const nodeIds = nodes.map(n => n.id);
            const { data: edges, error: edgesError } = await this.supabase
                .from('graph_edges')
                .select('*')
                .in('source_node', nodeIds)
                .in('target_node', nodeIds);
            if (edgesError) throw edgesError;

            return { nodes, edges };
        } catch (error) {
            logger.error('Get document graph error:', error);
            throw error;
        }
    }

    async deleteDocumentGraph(documentId) {
        try {
            const { data: nodes, error: nodesError } = await this.supabase
                .from('graph_nodes')
                .select('id')
                .eq('document_id', documentId);
            if (nodesError) throw nodesError;

            if (nodes && nodes.length > 0) {
                const nodeIds = nodes.map(n => n.id);
                await this.supabase
                    .from('graph_edges')
                    .delete()
                    .in('source_node', nodeIds)
                    .in('target_node', nodeIds);
                await this.supabase
                    .from('graph_nodes')
                    .delete()
                    .eq('document_id', documentId);
            }
            logger.info(`Graph deleted for document: ${documentId}`);
        } catch (error) {
            logger.error('Delete document graph error:', error);
            throw error;
        }
    }

    // ========== HELPER METHODS ==========

    getContentType(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const types = {
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'json': 'application/json'
        };
        return types[ext] || 'application/octet-stream';
    }

    // ========== HEALTH CHECK ==========

    async healthCheck() {
        try {
            const { data: storageData, error: storageError } = await this.supabase.storage
                .from(this.bucketName)
                .list('', { limit: 1 });
            if (storageError) throw storageError;

            const { data: dbData, error: dbError } = await this.supabase
                .from('documents')
                .select('count')
                .limit(1);
            if (dbError) throw dbError;

            return {
                healthy: true,
                storage: 'connected',
                database: 'connected',
                bucket: this.bucketName
            };
        } catch (error) {
            logger.error('Health check failed:', error);
            return { healthy: false, error: error.message };
        }
    }
}

// Export singleton instance
module.exports = new SupabaseService();
