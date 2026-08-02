import { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            status: 'error',
            error: {
                type: 'UNAUTHORIZED',
                description: 'Acceso no autorizado. Se requiere token Bearer.'
            }
        });
        return;
    }

    const accessToken = authHeader.split(' ')[1];
    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
        
        if (authError || !user) {
            res.status(401).json({
                status: 'error',
                error: {
                    type: 'INVALID_TOKEN',
                    description: 'Token de acceso invalido o expirado.'
                }
            });
            return;
        }

        res.locals.user = user;
        next();
    } catch (exception) {
        res.status(401).json({
            status: 'error',
            error: {
                type: 'AUTH_ERROR',
                description: 'Error en el proceso de autenticacion.'
            }
        });
    }
}
