import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import { Chat } from './components/Chat'
import { Skills } from './pages/Skills'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
