/**
 * Pegawai Service
 * Fetches internal employee profiles from master_pegawai MySQL table
 */

import { createLogger, NotFoundError } from '@sada/shared';
import mysql from 'mysql2/promise';

const logger = createLogger('pegawai-service');

// Environment variables for MySQL connection
const MYSQL_HOST = process.env['MYSQL_HOST'] ?? 'localhost';
const MYSQL_PORT = parseInt(process.env['MYSQL_PORT'] ?? '3306', 10);
const MYSQL_USER = process.env['MYSQL_USER'] ?? 'root';
const MYSQL_PASSWORD = process.env['MYSQL_PASSWORD'] ?? '';
const MYSQL_DATABASE = process.env['MYSQL_DATABASE'] ?? 'main_db';

// Internal email domain for identifying internal users
const INTERNAL_EMAIL_DOMAIN = process.env['INTERNAL_EMAIL_DOMAIN'] ?? 'bpjstk.go.id';

/**
 * Employee profile from master_pegawai
 */
export interface Pegawai {
    nip: string;
    nama: string;
    email: string;
    jabatan?: string;
    unit_kerja?: string;
    unit_staf_id?: number;
    foto?: string;
    status?: string;
}

// MySQL connection pool
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
    if (!pool) {
        pool = mysql.createPool({
            host: MYSQL_HOST,
            port: MYSQL_PORT,
            user: MYSQL_USER,
            password: MYSQL_PASSWORD,
            database: MYSQL_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        });
        logger.info('MySQL connection pool created for pegawai service');
    }
    return pool;
}

export const pegawaiService = {
    /**
     * Check if an email belongs to an internal user
     */
    isInternalEmail(email: string): boolean {
        const domain = email.split('@')[1]?.toLowerCase();
        return domain === INTERNAL_EMAIL_DOMAIN.toLowerCase();
    },

    /**
     * Get employee by email
     */
    async getByEmail(email: string): Promise<Pegawai | null> {
        const connection = getPool();

        try {
            const [rows] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT
                    nip,
                    nama,
                    email_kantor AS email,
                    unit_staf_id,
                    photo AS foto,
                    dihapus
                FROM master_pegawai
                WHERE (email_kantor = ? OR email_pribadi = ?) AND dihapus = 'tidak'
                LIMIT 1`,
                [email.toLowerCase(), email.toLowerCase()]
            );

            if (rows.length === 0) {
                return null;
            }

            const row = rows[0];
            return {
                nip: row.nip as string,
                nama: row.nama as string,
                email: row.email as string,
                unit_staf_id: row.unit_staf_id as number | undefined,
                foto: row.foto as string | undefined,
                status: 'aktif',
            };
        } catch (error) {
            logger.error('Failed to fetch pegawai by email', { email, error });
            throw error;
        }
    },

    /**
     * Get employee by NIP
     */
    async getByNip(nip: string): Promise<Pegawai | null> {
        const connection = getPool();

        try {
            const [rows] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT
                    nip,
                    nama,
                    email_kantor AS email,
                    unit_staf_id,
                    photo AS foto,
                    dihapus
                FROM master_pegawai
                WHERE nip = ? AND dihapus = 'tidak'
                LIMIT 1`,
                [nip]
            );

            if (rows.length === 0) {
                return null;
            }

            const row = rows[0];
            return {
                nip: row.nip as string,
                nama: row.nama as string,
                email: row.email as string,
                unit_staf_id: row.unit_staf_id as number | undefined,
                foto: row.foto as string | undefined,
                status: 'aktif',
            };
        } catch (error) {
            logger.error('Failed to fetch pegawai by NIP', { nip, error });
            throw error;
        }
    },

    /**
     * Check if MySQL is configured
     */
    isConfigured(): boolean {
        return !!(MYSQL_HOST && MYSQL_DATABASE);
    },

    /**
     * Close connection pool
     */
    async disconnect(): Promise<void> {
        if (pool) {
            await pool.end();
            pool = null;
            logger.info('MySQL connection pool closed');
        }
    },
};
