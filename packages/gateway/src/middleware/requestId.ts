import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function requestId(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const id = req.headers['x-request-id'] as string ?? crypto.randomUUID();
    res.locals['requestId'] = id;
    res.setHeader('X-Request-ID', id);
    next();
}
