import {mergeConfig} from 'vite';
import path from 'node:path';
import config from '../vite.config';

export default mergeConfig(config, {build: {rollupOptions: {input: {
    main: path.resolve(process.cwd(), 'index.html'),
    proxy: path.resolve(process.cwd(), 'test/proxy.html'),
}}}});
