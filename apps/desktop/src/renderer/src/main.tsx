import './lib/legacy'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// 창에 파일을 떨어뜨리면 Electron 이 그 파일로 이동해 버린다. 올리기는 채널 화면이 맡고, 나머지는 막는다.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
