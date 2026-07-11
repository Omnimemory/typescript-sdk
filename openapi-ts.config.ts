import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/router-v2.json',
  output: {
    path: 'src/generated',
  },
  plugins: ['@hey-api/client-fetch'],
});
