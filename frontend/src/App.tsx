import { createBrowserRouter, RouterProvider } from 'react-router'
import { routes } from './app/router'

const router = createBrowserRouter(routes)

export default function App() {
  return <RouterProvider router={router} />
}
