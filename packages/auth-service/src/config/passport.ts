import type { Express } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { prisma } from './database.js';
import { UserType } from '@sada/shared';

export function initPassport(app: Express): void {
    app.use(passport.initialize());

    // Google OAuth Strategy
    if (process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET']) {
        passport.use(new GoogleStrategy({
            clientID: process.env['GOOGLE_CLIENT_ID'],
            clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
            callbackURL: process.env['GOOGLE_CALLBACK_URL'] ?? '/auth/google/callback',
        }, async (_accessToken, _refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;

                if (!email) {
                    return done(new Error('No email found in Google profile'));
                }

                // Find or create user
                let user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { email },
                            { providerId: profile.id, provider: 'google' }
                        ]
                    }
                });

                if (!user) {
                    user = await prisma.user.create({
                        data: {
                            email,
                            name: profile.displayName ?? email,
                            userType: UserType.EXTERNAL,
                            provider: 'google',
                            providerId: profile.id,
                        }
                    });
                }

                return done(null, user);
            } catch (error) {
                return done(error as Error);
            }
        }));
    }

    // Facebook OAuth Strategy
    if (process.env['FACEBOOK_APP_ID'] && process.env['FACEBOOK_APP_SECRET']) {
        passport.use(new FacebookStrategy({
            clientID: process.env['FACEBOOK_APP_ID'],
            clientSecret: process.env['FACEBOOK_APP_SECRET'],
            callbackURL: process.env['FACEBOOK_CALLBACK_URL'] ?? '/auth/facebook/callback',
            profileFields: ['id', 'emails', 'name', 'displayName'],
        }, async (_accessToken, _refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;

                if (!email) {
                    return done(new Error('No email found in Facebook profile'));
                }

                let user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { email },
                            { providerId: profile.id, provider: 'facebook' }
                        ]
                    }
                });

                if (!user) {
                    user = await prisma.user.create({
                        data: {
                            email,
                            name: profile.displayName ?? email,
                            userType: UserType.EXTERNAL,
                            provider: 'facebook',
                            providerId: profile.id,
                        }
                    });
                }

                return done(null, user);
            } catch (error) {
                return done(error as Error);
            }
        }));
    }
}
