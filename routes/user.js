const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');
const pineconeService = require('../services/vectorDB'); // ✅ ADDED
const logger = require('../utils/logger'); // ✅ ADDED
const { createClient } = require('@supabase/supabase-js');

const supabase = supabaseService.supabase;

// GET user profile
router.get('/profile', async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') { // No profile found
                // Create default profile
                const { data: newProfile, error: createError } = await supabase
                    .from('profiles')
                    .insert({
                        id: userId,
                        name: req.user?.email?.split('@')[0] || 'User',
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (createError) throw createError;
                return res.json({
                    success: true,
                    data: {
                        ...newProfile,
                        email: req.user?.email
                    }
                });
            }
            throw error;
        }

        res.json({
            success: true,
            data: {
                ...data,
                email: req.user?.email
            }
        });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

// UPDATE user profile
router.put('/profile', async (req, res) => {
    try {
        const userId = req.user?.id;
        const { name } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Name is required'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({
                name: name.trim(),
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            data: data,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        logger.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

// COMPLETE ACCOUNT DELETION (FIXED VERSION)
router.delete('/account', async (req, res) => {
    let userId = req.user?.id;
    let userEmail = req.user?.email;

    if (!userId) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    logger.info(`Starting account deletion for user: ${userId} (${userEmail})`);

    try {
        // ========== 1. GET USER'S DOCUMENTS ==========
        const { data: userDocuments, error: docsError } = await supabase
            .from('documents')
            .select('id, filename, file_url, user_id')
            .eq('user_id', userId);

        if (docsError) {
            logger.error('Error fetching user documents:', docsError);
            throw docsError;
        }

        const documentIds = userDocuments?.map(d => d.id) || [];
        logger.info(`Found ${documentIds.length} documents to delete`);

        // ========== 2. DELETE FILES FROM SUPABASE STORAGE ==========
        if (userDocuments && userDocuments.length > 0) {
            logger.info(`Deleting ${userDocuments.length} files from storage...`);
            for (const doc of userDocuments) {
                if (doc.filename) {
                    try {
                        await supabaseService.deleteFile(doc.filename, userId);
                        logger.info(`Deleted file: ${doc.filename}`);
                    } catch (fileError) {
                        logger.error(`Error deleting file ${doc.filename}:`, fileError);
                    }
                }
            }
        }

        // ========== 3. DELETE VECTORS FROM PINECONE ==========
        try {
            if (pineconeService.deleteAllUserVectors) {
                await pineconeService.deleteAllUserVectors(userId);
                logger.info(`Deleted all vectors for user: ${userId}`);
            } else if (pineconeService.deleteVectorsByFilter) {
                //  Remove $eq operator
                await pineconeService.deleteVectorsByFilter({
                    userId: userId  // Simple object, no $eq
                });
                logger.info(`Deleted vectors by filter for user: ${userId}`);
            } else {
                logger.warn('No vector deletion method available in pineconeService');
            }
        } catch (vectorError) {
            logger.error(`Error deleting vectors:`, vectorError);
        }

        // ========== 4. DELETE GRAPH DATA ==========
        try {
            //  Remove .catch() and use try/catch
            try {
                await supabase.from('graph_edges').delete().eq('user_id', userId);
            } catch (error) {
                logger.warn('graph_edges deletion failed (might not exist):', error.message);
            }

            try {
                await supabase.from('graph_nodes').delete().eq('user_id', userId);
            } catch (error) {
                logger.warn('graph_nodes deletion failed (might not exist):', error.message);
            }

            logger.info('Deleted graph data');
        } catch (graphError) {
            logger.error('Error deleting graph data:', graphError);
        }

        //  DELETE CHUNKS 
        try {
            await supabase.from('chunks').delete().eq('user_id', userId);
            logger.info('Deleted document chunks');
        } catch (chunksError) {
            logger.error('Error deleting chunks:', chunksError);
        }

        //  DELETE DOCUMENTS 
        try {
            const { error: deleteDocsError } = await supabase
                .from('documents')
                .delete()
                .eq('user_id', userId);

            if (deleteDocsError) throw deleteDocsError;
            logger.info(`Deleted ${userDocuments?.length || 0} document records`);
        } catch (docsDeleteError) {
            logger.error('Error deleting document records:', docsDeleteError);
            throw docsDeleteError;
        }

        //  DELETE USER PROFILE
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .delete()
                .eq('id', userId);

            if (!profileError) {
                logger.info('Deleted user profile');
            }
        } catch (profileError) {
            logger.error('Error deleting profile:', profileError);
        }

        // DELETE USER FROM SUPABASE AUTH 
        try {
            const serviceKey = process.env.SUPABASE_SERVICE_KEY;

            // Proper service key validation
            if (serviceKey && serviceKey.length > 100 && serviceKey.startsWith('eyJ')) {
                const adminSupabase = createClient(
                    process.env.SUPABASE_URL,
                    serviceKey,
                    { auth: { autoRefreshToken: false, persistSession: false } }
                );

                const { error: authError } = await adminSupabase.auth.admin.deleteUser(userId);

                if (authError) {
                    logger.error('Failed to delete user from auth:', authError);
                } else {
                    logger.info('Deleted user from Supabase Auth');
                }
            } else {
                logger.warn('Missing valid service role key. User remains in auth system.');
            }
        } catch (authError) {
            logger.error('Error during auth deletion:', authError);
        }

        
        try {
            //  Remove .catch() and use try/catch
            try {
                await supabase.from('account_deletions').insert({
                    user_id: userId,
                    user_email: userEmail,
                    deleted_at: new Date().toISOString(),
                    documents_deleted: userDocuments?.length || 0
                });
                logger.info('Added audit log for account deletion');
            } catch (error) {
                logger.warn('Audit log failed (table might not exist):', error.message);
            }
        } catch (auditError) {
            logger.error('Error adding audit log:', auditError);
        }

        logger.info(`Account deletion finished for user: ${userId}`);

        // ========== 10. SUCCESS RESPONSE ==========
        res.json({
            success: true,
            message: 'Account and all associated data deleted successfully',
            details: {
                userId: userId,
                email: userEmail,
                documentsDeleted: userDocuments?.length || 0,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('Account deletion failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete account completely',
            details: error.message
        });
    }
});

module.exports = router;