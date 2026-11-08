import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/styles/theme.css';
import { mount } from 'svelte';
import MobileApp from './MobileApp.svelte';

const app = mount(MobileApp, { target: document.getElementById('app')! });

export default app;
