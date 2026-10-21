import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { Provider } from './store';
import { AuthProvider } from './auth';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <Provider>
          <App />
        </Provider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
