import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyTheme, getTheme } from './theme.js';

applyTheme(getTheme());

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
