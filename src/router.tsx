import { createBrowserRouter, useLocation } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import HomeScreen from './screens/HomeScreen'
import LiveTvScreen from './screens/LiveTvScreen'
import VodScreen from './screens/VodScreen'
import SeriesScreen from './screens/SeriesScreen'
import SearchScreen from './screens/SearchScreen'
import MyListScreen from './screens/MyListScreen'
import SettingsScreen from './screens/SettingsScreen'
import PlayerScreen from './screens/PlayerScreen'
import MultiviewScreen from './screens/MultiviewScreen'
import EpgScreen from './screens/EpgScreen'
import LoginScreen from './screens/LoginScreen'

// Forces a full remount of PlayerScreen on every navigation to /player,
// including replace: true (same-route) navigations for auto-play next episode.
// This ensures the MPV Android SurfaceView and HTML5 video element are
// properly re-initialized for each new episode.
function PlayerScreenWrapper() {
  const location = useLocation()
  return <PlayerScreen key={location.key} />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'live', element: <LiveTvScreen /> },
      { path: 'vod', element: <VodScreen /> },
      { path: 'series', element: <SeriesScreen /> },
      { path: 'search', element: <SearchScreen /> },
      { path: 'mylist', element: <MyListScreen /> },
      { path: 'epg', element: <EpgScreen /> },
      { path: 'multiview', element: <MultiviewScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
    ],
  },
  { path: '/player', element: <PlayerScreenWrapper /> },
  { path: '/login', element: <LoginScreen /> },
])
