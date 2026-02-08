import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Application } from 'express';

const swaggerOptions: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'SADA Auth Service API',
            version: '1.0.0',
            description: `
## SADA Authentication & OAuth 2.0 API

This API provides authentication and OAuth 2.0 authorization services for the SADA platform.

### Features
- **User Authentication**: Email/password and LDAP login
- **OAuth 2.0**: Authorization code, client credentials, and refresh token grants
- **PKCE Support**: Secure public client authentication
- **Client Management**: Register and manage OAuth clients
- **Token Management**: Issue, refresh, and revoke tokens

### Authentication Methods
- Bearer Token: \`Authorization: Bearer <access_token>\`
- OAuth Client Credentials: Client ID and Secret

### Security
All endpoints require appropriate authentication unless noted as public.
      `,
            contact: {
                name: 'SADA API Support',
                email: 'api@sada.example.com',
            },
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Development server',
            },
            {
                url: '/api',
                description: 'Production (via gateway)',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT access token',
                },
                clientCredentials: {
                    type: 'oauth2',
                    flows: {
                        clientCredentials: {
                            tokenUrl: '/oauth/token',
                            scopes: {
                                'openid': 'OpenID Connect',
                                'profile': 'User profile information',
                                'email': 'Email address',
                                'read': 'Read access',
                                'write': 'Write access',
                            },
                        },
                    },
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'object',
                            properties: {
                                code: { type: 'string' },
                                message: { type: 'string' },
                            },
                        },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        email: { type: 'string', format: 'email' },
                        name: { type: 'string' },
                        userType: {
                            type: 'string',
                            enum: ['INTERNAL', 'GOVERNMENT', 'EXTERNAL'],
                        },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },
                TokenResponse: {
                    type: 'object',
                    properties: {
                        access_token: { type: 'string' },
                        token_type: { type: 'string', example: 'Bearer' },
                        expires_in: { type: 'integer' },
                        refresh_token: { type: 'string' },
                        scope: { type: 'string' },
                    },
                },
                OAuthClient: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        redirectUris: {
                            type: 'array',
                            items: { type: 'string', format: 'uri' },
                        },
                        scopes: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                        grants: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                    },
                },
            },
        },
        tags: [
            { name: 'Auth', description: 'Authentication endpoints' },
            { name: 'OAuth', description: 'OAuth 2.0 endpoints' },
            { name: 'Clients', description: 'OAuth client management' },
            { name: 'Users', description: 'User management' },
            { name: 'Health', description: 'Service health checks' },
        ],
    },
    apis: [
        './packages/auth-service/src/routes/*.ts',
        './packages/auth-service/dist/routes/*.js',
        './src/routes/*.ts',
        './dist/routes/*.js',
    ],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export function setupSwagger(app: Application): void {
    // Serve Swagger UI
    app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, {
            explorer: true,
            customSiteTitle: 'SADA Auth API Docs',
            customCss: '.swagger-ui .topbar { display: none }',
        })
    );

    // Serve OpenAPI JSON spec
    app.get('/api-docs.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}

export { swaggerSpec };
