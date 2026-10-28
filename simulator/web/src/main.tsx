import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Presentation from './Presentation';
import './styles.css';

const presentation = new URLSearchParams(location.search).get('presentation') === '1';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{presentation ? <Presentation /> : <App />}</React.StrictMode>);
