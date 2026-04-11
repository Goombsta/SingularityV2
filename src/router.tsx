import { createBrowserRouter } from 'react-router-dom'
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
  { path: '/player', element: <PlayerScreen /> },
])
