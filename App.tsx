import React, { useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Home, Send, Receive, History, TabBar } from './src/screens';

export default function App() {
  const [route, setRoute] = useState('home');
  const back = () => setRoute('home');
  const showTabs = route === 'home' || route === 'history';
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* dark icons: home has a yellow header, other screens are white */}
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {route === 'home' && <Home go={setRoute} />}
        {route === 'send' && <Send back={back} />}
        {route === 'receive' && <Receive back={back} />}
        {route === 'history' && <History back={back} />}
      </View>
      {showTabs && <TabBar route={route} go={setRoute} />}
    </View>
  );
}
