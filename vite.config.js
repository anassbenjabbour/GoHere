import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    plugins: [
        react(),
        basicSsl(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['pwa.svg'],
            manifest: {
                name: 'Go Here',
                short_name: 'Go Here',
                description: 'Retro terminal adventure map for random exploration.',
                theme_color: '#0b0b0b',
                background_color: '#050505',
                display: 'standalone',
                orientation: 'portrait',
                scope: '/',
                start_url: '/',
                icons: [
                    {
                        src: '/pwa.svg',
                        sizes: 'any',
                        type: 'image/svg+xml'
                    }
                ]
            },
            workbox: {
                navigateFallback: '/index.html',
                runtimeCaching: [
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            if (url.origin !== 'https://tile.openstreetmap.org') {
                                return false;
                            }
                            var tilePathSegments = url.pathname.split('/').filter(Boolean);
                            if (tilePathSegments.length < 3) {
                                return false;
                            }
                            var zoom = Number(tilePathSegments[0]);
                            return Number.isFinite(zoom) && zoom >= 11 && zoom <= 17;
                        },
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'osm-city-pack-v1',
                            expiration: {
                                maxEntries: 280,
                                maxAgeSeconds: 60 * 60 * 24 * 14
                            },
                            cacheableResponse: {
                                statuses: [0, 200]
                            }
                        }
                    },
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.hostname.includes('overpass-api.de');
                        },
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'overpass-api',
                            networkTimeoutSeconds: 4,
                            expiration: {
                                maxEntries: 24,
                                maxAgeSeconds: 60 * 60 * 24 * 7
                            },
                            cacheableResponse: {
                                statuses: [0, 200]
                            }
                        }
                    },
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.hostname.includes('nominatim.openstreetmap.org');
                        },
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'nominatim-api',
                            networkTimeoutSeconds: 4,
                            expiration: {
                                maxEntries: 48,
                                maxAgeSeconds: 60 * 60 * 24 * 7
                            },
                            cacheableResponse: {
                                statuses: [0, 200]
                            }
                        }
                    },
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.hostname.includes('router.project-osrm.org');
                        },
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'osrm-routes',
                            networkTimeoutSeconds: 4,
                            expiration: {
                                maxEntries: 64,
                                maxAgeSeconds: 60 * 60 * 24 * 14
                            },
                            cacheableResponse: {
                                statuses: [0, 200]
                            }
                        }
                    }
                ]
            },
            devOptions: {
                enabled: true
            }
        })
    ]
});
