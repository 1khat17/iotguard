import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from "../config/firebase";
import { Client as PahoClient } from 'paho-mqtt';
import {
  FiLogOut, FiAlertTriangle, FiThermometer, FiDroplet, FiWind, FiAlertCircle,
  FiClock, FiRefreshCw, FiSettings, FiDownload, FiCheck, FiX, FiMenu,
  FiHome, FiBell, FiSliders, FiUser, FiVolume2, FiVolumeX, FiMail, FiActivity,
  FiShield,
} from 'react-icons/fi';
import { FaAmbulance, FaFire } from 'react-icons/fa';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';
import { motion, AnimatePresence } from 'framer-motion';
import Chart from 'chart.js/auto';
import './styles/Dashboard.css';
import detectionSound from '../sounds/detection.mp3';

// Stub StreamService
const StreamService = {
  getStreamUrl: async () => ({ url: 'http://192.168.45.104:81/stream' }),
};

// Constants
const DEFAULT_THRESHOLDS = {
  temperature: 50.0,
  humidity: 30.0,
  mq135_co2: 500.0,
  mq5: 10.0,
  human_detection: 0.8,
};

const SENSOR_INFO = [
  { id: 'temperature', name: 'Temperature', topic: 'esp32/temperature', icon: <FiThermometer />, unit: '°C', max: 100 },
  { id: 'humidity', name: 'Humidity', topic: 'esp32/humidity', icon: <FiDroplet />, unit: '%', max: 100 },
  { id: 'mq135_co2', name: 'CO2 Level', topic: 'esp32/mq135/co2', icon: <FiWind />, unit: 'ppm', max: 5000 },
  { id: 'mq5', name: 'Gas Level', topic: 'esp32/mq5', icon: <FiAlertCircle />, unit: 'ppm', max: 5000 },
  { id: 'human_detection', name: 'Human Detection', topic: 'esp32cam/human_detection', icon: <FiUser />, unit: '', max: 1 },
];

// Error Boundary Component
class DashboardErrorBoundary extends React.Component {
  state = { hasError: false, error: null, errorInfo: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Dashboard Error:', error, errorInfo);
    this.setState({ errorInfo });
    toast.error('An error occurred. Try refreshing or reconnecting.');
  }
  handleRefresh = () => window.location.reload();
  handleReconnect = () => {
    this.props.onReconnect();
    this.setState({ hasError: false, error: null, errorInfo: null });
  };
  handleLogout = async () => {
    try {
      await auth.signOut();
      this.props.navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out. Please try again.');
    }
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-content">
            <FiAlertTriangle className="error-icon" />
            <h2>Something went wrong</h2>
            <p>Please try one of the following to resolve the issue:</p>
            <div className="error-actions">
              <motion.button onClick={this.handleRefresh} className="action-btn" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <FiRefreshCw /> Refresh Page
              </motion.button>
              <motion.button onClick={this.handleReconnect} className="action-btn" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <FiActivity /> Reconnect MQTT
              </motion.button>
              <motion.button onClick={this.handleLogout} className="action-btn danger" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <FiLogOut /> Logout
              </motion.button>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <details className="error-details">
                <summary>Developer Info</summary>
                <pre>{this.state.error?.toString()}</pre>
                <pre>{this.state.errorInfo?.componentStack}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Debounce utility function
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// SensorChart Component
const SensorChart = memo(({ sensorId, getChartData, chartOptions }) => {
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = canvasRef.current.getContext('2d');
    const chartData = getChartData(sensorId);
    const options = chartOptions(sensorId);

    try {
      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
          ...options,
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 2,
          plugins: {
            legend: { position: 'top', labels: { font: { size: 10 } } },
            title: { display: false },
          },
          scales: {
            y: {
              beginAtZero: true,
              max: options.scales.y.max,
              ticks: { font: { size: 10 } },
            },
            x: {
              ticks: { font: { size: 10 } },
            },
          },
        },
      });
    } catch (error) {
      console.error(`Error creating chart for sensor ${sensorId}:`, error);
      toast.error(`Failed to render chart for ${sensorId}`);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [sensorId, getChartData, chartOptions]);

  return (
    <div className="sensor-chart-container">
      <canvas ref={canvasRef} id={`chart-${sensorId}`} style={{ maxHeight: '150px', width: '100%' }} />
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.sensorId === nextProps.sensorId &&
         JSON.stringify(prevProps.getChartData(prevProps.sensorId)) === JSON.stringify(nextProps.getChartData(nextProps.sensorId)) &&
         JSON.stringify(prevProps.chartOptions(prevProps.sensorId)) === JSON.stringify(nextProps.chartOptions(nextProps.sensorId));
});

const Dashboard = () => {
  const MQTT_HOST = "0709b17d8bae4c05b594725605704f28.s1.eu.hivemq.cloud";
  const MQTT_PORT = 8884;
  const MQTT_USERNAME = "Samsona02";
  const MQTT_PASSWORD = "Samsona02";
  const MQTT_CLIENT_ID = `clientId-${Math.random().toString(16).slice(2, 8)}`;
  const TOPICS = SENSOR_INFO.map(sensor => sensor.topic).concat(['esp32/alerts']);
  const MAX_RECONNECT_ATTEMPTS = 10;

  const dashboardRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const detectionSoundRef = useRef(null);
  const streamRefreshRef = useRef(null);
  const pahoClientRef = useRef(null);
  const alertTimeoutRefs = useRef({});
  const toastIdsRef = useRef({});

  const [sensorData, setSensorData] = useState({
    temperature: 0,
    humidity: 0,
    mq135_co2: 0,
    mq5: 0,
    human_detection: 0,
    lastUpdated: '-',
  });
  const [sensorHistory, setSensorHistory] = useState({
    temperature: [],
    humidity: [],
    mq135_co2: [],
    mq5: [],
    human_detection: [],
  });
  const [thresholds, setThresholds] = useState(() => {
    const saved = localStorage.getItem('thresholds');
    return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
  });
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [connectionColor, setConnectionColor] = useState('#ff4757');
  const [alerts, setAlerts] = useState(() => {
    const saved = localStorage.getItem('alerts');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeAlerts, setActiveAlerts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [tempThresholds, setTempThresholds] = useState(thresholds);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeHelpline, setActiveHelpline] = useState(null);
  const [personDetected, setPersonDetected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.5);
  const [humanDetectionBox, setHumanDetectionBox] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('dashboard-theme') || 'dark');
  const [streamError, setStreamError] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastMessageTime, setLastMessageTime] = useState(null);
  const [sensorStatus, setSensorStatus] = useState({
    temperature: false,
    humidity: false,
    mq135_co2: false,
    mq5: false,
    human_detection: false,
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isHumanDetectionEnabled, setIsHumanDetectionEnabled] = useState(() => {
    const saved = localStorage.getItem('humanDetectionEnabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const navigate = useNavigate();
// Email sending function using the imported sendEmail
const handleSendEmail = useCallback(async (email, alertData) => {
  try {
    const subject = `IoT Guard Alert: ${alertData.type || 'Notification'}`;
    const text = `Alert Details:\n\nMessage: ${alertData.message}\nTimestamp: ${new Date(alertData.timestamp).toLocaleString()}\nValue: ${alertData.value || 'N/A'}\n\nPlease check your dashboard for more details.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff6b6b;">IoT Guard Alert</h2>
        <h3>${alertData.type || 'Notification'}</h3>
        <p><strong>Message:</strong> ${alertData.message}</p>
        <p><strong>Time:</strong> ${new Date(alertData.timestamp).toLocaleString()}</p>
        ${alertData.value ? `<p><strong>Value:</strong> ${alertData.value}</p>` : ''}
        <hr style="border: 1px solid #eee; margin: 20px 0;">
        <p>Please check your dashboard for more details.</p>
        <p style="font-size: 12px; color: #999;">
          This is an automated message. Please do not reply directly to this email.
        </p>
      </div>
    `;

    const result = await sendEmail({ to: email, subject, text, html });
    if (!result.success) {
      throw new Error(result.message || 'Failed to send email');
    }

    return true;
  } catch (error) {
    console.error('Email send error:', error);
    throw error;
  }
}, []);

const sendPushNotification = useCallback(async (title, body) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      await new Notification(title, {
        body,
        icon: '/favicon.ico',
      });
    } catch (error) {
      console.error('Push notification error:', error);
    }
  }
}, []);

const sendEmailNotification = useCallback(async (alertData) => {
  try {
    await handleSendEmail(userEmail, alertData);
    toast.info('Alert notification sent to email.');
  } catch (error) {
    console.error('Email notification error:', error);
    toast.error('Failed to send email notification.');
  }
}, [userEmail, handleSendEmail]);

  const handleThresholdAlert = useCallback((sensorId, value, now) => {
    const sensor = SENSOR_INFO.find(s => s.id === sensorId);
    if (!sensor) return;
    const isHumidity = sensorId === 'humidity';
    const isExceeding = isHumidity ? value < thresholds[sensorId] && value > 0 : value >= thresholds[sensorId];
    const alertId = `${sensor.topic.replace(/\//g, '-')}-${sensorId}`;

    setActiveAlerts(prev => {
      const isCurrentlyAlerting = prev[sensorId];
      const shouldAlert = isExceeding && !isCurrentlyAlerting;
      const shouldClear = !isExceeding && isCurrentlyAlerting;

      if (shouldAlert) {
        const newAlert = {
          id: alertId,
          type: sensor.topic,
          message: `"${sensor.name}" ${isHumidity ? 'below' : 'exceeds'} threshold: ${value.toFixed(1)}${sensor.unit}`,
          value,
          timestamp: now.toLocaleString(),
          acknowledged: false,
        };
        setAlerts(prevAlerts => {
          if (prevAlerts.some(a => a.id === alertId && !a.acknowledged)) return prevAlerts;
          if (soundEnabled && detectionSoundRef.current) {
            try {
              detectionSoundRef.current.currentTime = 0;
              const playPromise = detectionSoundRef.current.play();
              if (playPromise !== undefined) playPromise.catch(e => console.warn('Audio play failed:', e));
            } catch (e) {
              console.warn('Error playing sound:', e);
            }
          }
          if (!toast.isActive(toastIdsRef.current[sensorId])) {
            toastIdsRef.current[sensorId] = toast.warn(`${sensor.name} Alert: ${newAlert.message}`, {
              autoClose: false,
              onClose: () => delete toastIdsRef.current[sensorId],
            });
          }
          sendPushNotification(`${sensor.name} Alert`, newAlert.message);
          sendEmailNotification(newAlert);
          return [newAlert, ...prevAlerts].slice(0, 50);
        });
        return { ...prev, [sensorId]: true };
      } else if (shouldClear) {
        setAlerts(prevAlerts => prevAlerts.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
        if (toastIdsRef.current[sensorId]) {
          toast.dismiss(toastIdsRef.current[sensorId]);
          delete toastIdsRef.current[sensorId];
        }
        return { ...prev, [sensorId]: false };
      }
      return prev;
    });
  }, [soundEnabled, thresholds, sendEmailNotification, sendPushNotification]);

  const updateSensorData = useCallback((topic, value) => {
    try {
      const sensorValue = parseFloat(value);
      if (isNaN(sensorValue) || sensorValue < 0) return;
      const now = new Date();
      const updatedFields = { lastUpdated: now.toLocaleTimeString() };
      let sensorId;
      switch (topic) {
        case 'esp32/temperature':
          sensorId = 'temperature';
          updatedFields.temperature = sensorValue;
          setSensorStatus(prev => ({ ...prev, temperature: true }));
          setSensorHistory(prev => ({
            ...prev,
            temperature: [...prev.temperature.slice(-9), sensorValue],
          }));
          handleThresholdAlert(sensorId, sensorValue, now);
          break;
        case 'esp32/humidity':
          sensorId = 'humidity';
          updatedFields.humidity = sensorValue;
          setSensorStatus(prev => ({ ...prev, humidity: true }));
          setSensorHistory(prev => ({
            ...prev,
            humidity: [...prev.humidity.slice(-9), sensorValue],
          }));
          handleThresholdAlert(sensorId, sensorValue, now);
          break;
        case 'esp32/mq135/co2':
          sensorId = 'mq135_co2';
          updatedFields.mq135_co2 = sensorValue;
          setSensorStatus(prev => ({ ...prev, mq135_co2: true }));
          setSensorHistory(prev => ({
            ...prev,
            mq135_co2: [...prev.mq135_co2.slice(-9), sensorValue],
          }));
          handleThresholdAlert(sensorId, sensorValue, now);
          break;
        case 'esp32/mq5':
          sensorId = 'mq5';
          updatedFields.mq5 = sensorValue;
          setSensorStatus(prev => ({ ...prev, mq5: true }));
          setSensorHistory(prev => ({
            ...prev,
            mq5: [...prev.mq5.slice(-9), sensorValue],
          }));
          handleThresholdAlert(sensorId, sensorValue, now);
          break;
        default:
          return;
      }
      setSensorData(prev => ({ ...prev, ...updatedFields }));
    } catch (err) {
      console.error('Error updating sensor data:', err);
      toast.error('Error updating sensor data.');
    }
  }, [handleThresholdAlert]);

  const handleHumanDetection = useCallback((data) => {
    if (!isHumanDetectionEnabled) {
      setSensorStatus(prev => ({ ...prev, human_detection: false }));
      setSensorData(prev => ({
        ...prev,
        human_detection: 0,
        lastUpdated: new Date().toLocaleTimeString(),
      }));
      return;
    }

    try {
      let detection = {};
      let confidence = 0;
      let timestamp = new Date().getTime();
      if (typeof data === 'string' && data.startsWith('{')) {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          if (parsed.hasOwnProperty('detection')) {
            confidence = parsed.detection === true ? 0.85 : 0;
            if (parsed.count > 0) confidence = 0.85;
            detection = {
              x: parsed.x || 100,
              y: parsed.y || 100,
              width: parsed.w || parsed.width || 100,
              height: parsed.h || parsed.height || 100,
              confidence,
            };
          } else if (parsed.hasOwnProperty('confidence')) {
            confidence = parsed.confidence;
            detection = {
              x: parsed.x || 100,
              y: parsed.y || 100,
              width: parsed.w || parsed.width || 100,
              height: parsed.h || parsed.height || 100,
              confidence,
            };
          }
        }
      } else if (typeof data === 'string' && data.includes('%')) {
        const match = data.match(/(\d+\.\d+)% \[x:(\d+) y:(\d+) w:(\d+) h:(\d+)\]/);
        if (match) {
          confidence = parseFloat(match[1]) / 100;
          detection = {
            confidence,
            x: parseInt(match[2]),
            y: parseInt(match[3]),
            width: parseInt(match[4]),
            height: parseInt(match[5]),
          };
        }
      } else if (typeof data === 'string' && (data.toLowerCase().includes('detected') || data === '1' || parseFloat(data) > 0)) {
        confidence = parseFloat(data) || 0.85;
        detection = {
          confidence,
          x: 100,
          y: 100,
          width: 100,
          height: 100,
        };
      }
      setSensorStatus(prev => ({ ...prev, human_detection: !!confidence }));
      setSensorData(prev => ({
        ...prev,
        human_detection: confidence,
        lastUpdated: new Date().toLocaleTimeString(),
      }));
      setSensorHistory(prev => ({
        ...prev,
        human_detection: [...prev.human_detection.slice(-9), confidence],
      }));
      setActiveAlerts(prev => {
        const isCurrentlyAlerting = prev.human_detection;
        const shouldAlert = confidence >= thresholds.human_detection && !isCurrentlyAlerting;
        const shouldClear = confidence < thresholds.human_detection && isCurrentlyAlerting;

        if (shouldAlert) {
          setPersonDetected(true);
          setHumanDetectionBox(detection);
          const now = new Date();
          const alertId = `person-${timestamp}`;
          const newAlert = {
            id: alertId,
            type: 'person',
            message: `"Person detected" with ${Math.round(confidence * 100)}% confidence`,
            value: confidence,
            timestamp: now.toLocaleString(),
            acknowledged: false,
          };
          setAlerts(prevAlerts => {
            if (prevAlerts.some(a => a.id === alertId && !a.acknowledged)) return prevAlerts;
            if (soundEnabled && detectionSoundRef.current) {
              try {
                detectionSoundRef.current.currentTime = 0;
                const playPromise = detectionSoundRef.current.play();
                if (playPromise !== undefined) playPromise.catch(e => console.warn('Audio play failed:', e));
              } catch (e) {
                console.warn('Error playing sound:', e);
              }
            }
            if (!toast.isActive(toastIdsRef.current.human_detection)) {
              toastIdsRef.current.human_detection = toast.warn(`Human Detection: ${newAlert.message}`, {
                autoClose: false,
                onClose: () => delete toastIdsRef.current.human_detection,
              });
            }
            sendPushNotification('Human Detection Alert', newAlert.message);
            sendEmailNotification(newAlert);
            return [newAlert, ...prevAlerts].slice(0, 50);
          });
          if (alertTimeoutRefs.current.person) clearTimeout(alertTimeoutRefs.current.person);
          alertTimeoutRefs.current.person = setTimeout(() => {
            setPersonDetected(false);
            setHumanDetectionBox(null);
            setSensorData(prev => ({
              ...prev,
              human_detection: 0,
              lastUpdated: new Date().toLocaleTimeString(),
            }));
            setActiveAlerts(prev => ({ ...prev, human_detection: false }));
            if (toastIdsRef.current.human_detection) {
              toast.dismiss(toastIdsRef.current.human_detection);
              delete toastIdsRef.current.human_detection;
            }
            setAlerts(prevAlerts => prevAlerts.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
          }, 5000);
          return { ...prev, human_detection: true };
        } else if (shouldClear) {
          setPersonDetected(false);
          setHumanDetectionBox(null);
          if (toastIdsRef.current.human_detection) {
            toast.dismiss(toastIdsRef.current.human_detection);
            delete toastIdsRef.current.human_detection;
          }
          setAlerts(prevAlerts => prevAlerts.map(a => a.type === 'person' && !a.acknowledged ? { ...a, acknowledged: true } : a));
          return { ...prev, human_detection: false };
        }
        return prev;
      });
    } catch (err) {
      console.error('Error parsing human detection:', err);
      setSensorStatus(prev => ({ ...prev, human_detection: false }));
      toast.error('Error processing human detection data.');
    }
  }, [soundEnabled, thresholds.human_detection, sendEmailNotification, sendPushNotification, isHumanDetectionEnabled]);

  const debouncedHandleHumanDetection = debounce(handleHumanDetection, 500);

  const handleAlertMessage = useCallback((data) => {
    try {
      let alert;
      try {
        alert = JSON.parse(data);
      } catch {
        alert = {
          id: `manual-${Date.now()}`,
          type: data.includes('temperature') ? 'esp32/temperature' :
                data.includes('humidity') ? 'esp32/humidity' :
                data.includes('co2') ? 'esp32/mq135/co2' :
                data.includes('gas') ? 'esp32/mq5' :
                data.includes('human') ? 'esp32cam/human_detection' : 'unknown',
          message: data,
          value: parseFloat(data.match(/(\d+\.\d+)/)?.[1] || 0),
          timestamp: new Date().toLocaleString(),
          acknowledged: false,
        };
      }
      const sensorId = SENSOR_INFO.find(s => s.topic === alert.type)?.id || 'unknown';
      setActiveAlerts(prev => {
        if (prev[sensorId]) return prev;
        setAlerts(prevAlerts => {
          if (prevAlerts.some(a => a.id === alert.id && !a.acknowledged)) return prevAlerts;
          if (soundEnabled && detectionSoundRef.current) {
            try {
              detectionSoundRef.current.currentTime = 0;
              const playPromise = detectionSoundRef.current.play();
              if (playPromise !== undefined) playPromise.catch(e => console.warn('Audio play failed:', e));
            } catch (e) {
              console.warn('Error playing sound:', e);
            }
          }
          if (!toast.isActive(toastIdsRef.current[sensorId])) {
            toastIdsRef.current[sensorId] = toast.warn(`Alert: ${alert.message}`, {
              autoClose: false,
              onClose: () => delete toastIdsRef.current[sensorId],
            });
          }
          sendPushNotification('IoT Guard Alert', alert.message);
          sendEmailNotification(alert);
          return [alert, ...prevAlerts].slice(0, 50);
        });
        return { ...prev, [sensorId]: true };
      });
    } catch (err) {
      console.error('Error parsing alert message:', err);
      toast.error('Error processing alert message.');
    }
  }, [soundEnabled, sendEmailNotification, sendPushNotification]);

  const scheduleReconnect = useCallback((backoff = 2000) => {
    if (!reconnectTimerRef.current && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      setConnectionStatus(`Reconnecting in ${Math.round(backoff / 1000)}s`);
      reconnectTimerRef.current = setTimeout(() => {
        connectToPaho();
        reconnectTimerRef.current = null;
      }, backoff);
    }
  }, [connectionAttempts]);

  const connectToPaho = useCallback(() => {
    if (pahoClientRef.current?.isConnected?.()) return;

    console.log(`Attempting to connect to ${MQTT_HOST}:${MQTT_PORT}, attempt ${connectionAttempts + 1}`);
    try {
      if (pahoClientRef.current) {
        console.log('Disconnecting existing client');
        try {
          pahoClientRef.current.disconnect();
        } catch (err) {
          console.warn('Error disconnecting existing client:', err);
        }
      }

      const client = new PahoClient(MQTT_HOST, MQTT_PORT, MQTT_CLIENT_ID);
      client.onConnectionLost = (responseObject) => {
        console.error(`Connection lost: ${responseObject.errorMessage}`);
        setConnectionStatus(`Disconnected: ${responseObject.errorMessage}`);
        setConnectionColor('#ff4757');
        toast.error(`MQTT connection lost: ${responseObject.errorMessage}. Reconnecting...`);
        scheduleReconnect();
      };

      client.onMessageArrived = (message) => {
        if (!client.isConnected()) return;
        console.log(`Message received on topic ${message.destinationName}: ${message.payloadString}`);
        setLastMessageTime(new Date());
        const topic = message.destinationName;
        const payload = message.payloadString;

        if (topic === 'esp32cam/human_detection') debouncedHandleHumanDetection(payload);
        else if (topic === 'esp32/alerts') handleAlertMessage(payload);
        else updateSensorData(topic, payload);
      };

      client.connect({
        useSSL: true,
        userName: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        keepAliveInterval: 60,
        reconnect: false,
        timeout: 10,
        onSuccess: () => {
          console.log('Connected to MQTT broker successfully');
          setConnectionStatus('Connected');
          setConnectionColor('#2ed573');
          setConnectionAttempts(0);
          TOPICS.forEach(topic => {
            try {
              client.subscribe(topic, { qos: 1 });
            } catch (err) {
              console.error(`Error subscribing to topic ${topic}:`, err);
              toast.error(`Failed to subscribe to ${topic}`);
            }
          });
          toast.success('Connected to MQTT broker.');
        },
        onFailure: (err) => {
          const newAttempts = connectionAttempts + 1;
          setConnectionAttempts(newAttempts);
          const backoff = Math.min(30000, Math.pow(2, newAttempts) * 1000);
          console.error(`Connection attempt ${newAttempts} failed: ${err.errorMessage}, retrying in ${backoff / 1000}s`);
          setConnectionStatus(`Connection Failed: Retrying in ${Math.round(backoff / 1000)}s`);
          setConnectionColor('#ff4757');
          toast.error(`MQTT connection failed: ${err.errorMessage}. Retrying in ${Math.round(backoff / 1000)}s.`);
          scheduleReconnect(backoff);
        },
      });

      pahoClientRef.current = client;
    } catch (err) {
      console.error('Error initializing MQTT client:', err);
      setConnectionStatus('Connection Error');
      setConnectionColor('#ff4757');
      toast.error(`MQTT connection error: ${err.message}. Retrying...`);
      scheduleReconnect();
    }
  }, [connectionAttempts, scheduleReconnect, updateSensorData, handleAlertMessage, debouncedHandleHumanDetection]);

  useEffect(() => {
    localStorage.setItem('humanDetectionEnabled', JSON.stringify(isHumanDetectionEnabled));
  }, [isHumanDetectionEnabled]);

  useEffect(() => {
    const loadStreamUrl = async () => {
      try {
        const result = await StreamService.getStreamUrl();
        setStreamUrl(result.url);
      } catch (error) {
        console.error('Error getting stream URL:', error);
        setStreamUrl('http://192.168.45.104:81/stream');
        setStreamError(true);
      }
    };
    loadStreamUrl();
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        setUserName(user.displayName || user.email.split('@')[0]);
        setUserEmail(user.email);
      } else {
        navigate('/login');
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    localStorage.setItem('dashboard-theme', theme);
  }, [theme]);

  useEffect(() => {
    const sound = new Audio(detectionSound);
    sound.volume = soundVolume;
    sound.load();
    const handleAudioError = (e) => {
      console.warn('Audio loading failed:', e);
      toast.warn('Failed to load alert sound.');
    };
    sound.addEventListener('error', handleAudioError);
    detectionSoundRef.current = sound;
    return () => {
      if (detectionSoundRef.current) {
        detectionSoundRef.current.removeEventListener('error', handleAudioError);
        detectionSoundRef.current.pause();
        detectionSoundRef.current = null;
      }
    };
  }, [soundVolume]);

  useEffect(() => {
    localStorage.setItem('thresholds', JSON.stringify(thresholds));
  }, [thresholds]);

  useEffect(() => {
    localStorage.setItem('alerts', JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    const checkConnectionHealth = () => {
      if (lastMessageTime && connectionStatus === 'Connected') {
        const now = new Date();
        const timeSinceLastMessage = (now - lastMessageTime) / 1000;
        if (timeSinceLastMessage > 30) {
          console.log('No messages in 30s, reconnecting...');
          setConnectionStatus('Reconnecting...');
          setConnectionColor('#ffa502');
          connectToPaho();
        }
      }
    };
    const healthCheckInterval = setInterval(checkConnectionHealth, 10000);
    return () => clearInterval(healthCheckInterval);
  }, [lastMessageTime, connectionStatus, connectToPaho]);

  useEffect(() => {
    setIsLoading(false);
    connectToPaho();
    streamRefreshRef.current = setInterval(() => {
      setStreamUrl(prev => `${prev.split('?')[0]}?t=${new Date().getTime()}`);
      setStreamError(false);
    }, 15000);
    const handleReconnect = () => connectToPaho();
    window.addEventListener('reconnect-mqtt', handleReconnect);
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pahoClientRef.current?.isConnected?.()) {
        try {
          pahoClientRef.current.disconnect();
        } catch (err) {
          console.warn('Error disconnecting MQTT client:', err);
        }
      }
      if (streamRefreshRef.current) clearInterval(streamRefreshRef.current);
      Object.values(alertTimeoutRefs.current).forEach(timeout => clearTimeout(timeout));
      Object.keys(toastIdsRef.current).forEach(id => toast.dismiss(toastIdsRef.current[id]));
      window.removeEventListener('reconnect-mqtt', handleReconnect);
      pahoClientRef.current = null;
    };
  }, [connectToPaho]);

  const acknowledgeAlert = useCallback((id, sensorId) => {
    setAlerts(prev => prev.map(alert => (alert.id === id ? { ...alert, acknowledged: true } : alert)));
    setActiveAlerts(prev => ({ ...prev, [sensorId]: false }));
    if (toastIdsRef.current[sensorId]) {
      toast.dismiss(toastIdsRef.current[sensorId]);
      delete toastIdsRef.current[sensorId];
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await auth.signOut();
      navigate('/login');
      toast.success('Logged out successfully.');
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out.');
    }
  }, [navigate]);

  const refreshData = useCallback(() => {
    setIsLoading(true);
    if (pahoClientRef.current?.isConnected?.()) {
      try {
        pahoClientRef.current.disconnect();
      } catch (err) {
        console.warn('Error disconnecting during refresh:', err);
      }
    }
    setStreamUrl(prev => `${prev.split('?')[0]}?t=${new Date().getTime()}`);
    setTimeout(() => {
      connectToPaho();
      setIsLoading(false);
      toast.info('Data refreshed.');
    }, 1000);
  }, [connectToPaho]);

  const openThresholdModal = useCallback(() => {
    setTempThresholds(thresholds);
    setShowThresholdModal(true);
    document.body.style.overflow = 'hidden';
  }, [thresholds]);

  const saveThresholds = useCallback(() => {
    setThresholds(tempThresholds);
    setShowThresholdModal(false);
    document.body.style.overflow = 'auto';
    toast.success('Thresholds saved.');
  }, [tempThresholds]);

  const resetThresholds = useCallback(() => {
    setTempThresholds(DEFAULT_THRESHOLDS);
    toast.info('Thresholds reset to defaults.');
  }, []);

  const closeThresholdModal = useCallback(() => {
    setShowThresholdModal(false);
    document.body.style.overflow = 'auto';
  }, []);

  const escapeCsvValue = (value) => {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const exportData = useCallback(() => {
    const timestamp = new Date().toISOString();
    const csvRows = [
      'Timestamp,Sensor,Current Value,Threshold,Status,Alert Active,History (Last 10 Values),Alert Message,Alert Timestamp,Alert Acknowledged'
    ];
    SENSOR_INFO.forEach(sensor => {
      const value = sensorData[sensor.id] || 0;
      const threshold = thresholds[sensor.id] || 0;
      const status = sensorStatus[sensor.id] ? 'Active' : 'Inactive';
      const alertActive = activeAlerts[sensor.id] ? 'Yes' : 'No';
      const history = sensorHistory[sensor.id].map(v => v.toFixed(1)).join(';') || 'No data';
      const latestAlert = alerts.find(a => a.type === sensor.topic && !a.acknowledged) || {};
      const alertMessage = latestAlert.message || '';
      const alertTimestamp = latestAlert.timestamp || '';
      const alertAcknowledged = latestAlert.acknowledged ? 'Yes' : 'No';
      csvRows.push([
        escapeCsvValue(timestamp),
        escapeCsvValue(sensor.name),
        escapeCsvValue(value.toFixed(1)),
        escapeCsvValue(threshold),
        escapeCsvValue(status),
        escapeCsvValue(alertActive),
        escapeCsvValue(history),
        escapeCsvValue(alertMessage),
        escapeCsvValue(alertTimestamp),
        escapeCsvValue(alertAcknowledged)
      ].join(','));
    });
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `iot-guard-data-${timestamp.slice(0, 10)}.csv`);
    toast.success('Data exported successfully as CSV.');
  }, [sensorData, sensorHistory, thresholds, sensorStatus, alerts, activeAlerts]);

  const exportDashboardImage = useCallback(async () => {
    if (dashboardRef.current) {
      try {
        const canvas = await html2canvas(dashboardRef.current, {
          useCORS: true,
          scale: 2,
          backgroundColor: theme === 'dark' ? '#1a1a2e' : '#f5f5f5',
        });
        canvas.toBlob(blob => saveAs(blob, `iot-guard-dashboard-${new Date().toISOString().slice(0, 10)}.png`));
        toast.success('Dashboard image exported successfully.');
      } catch (err) {
        console.error('Error exporting dashboard image:', err);
        toast.error('Failed to export dashboard image.');
      }
    }
  }, [theme]);

  const handleContactUs = useCallback(() => {
    window.location.href = 'mailto:support@iotguard.com?subject=IoT%20Guard%20Support%20Request';
    toast.info('Opening email client.');
  }, []);

  const getSensorIcon = useCallback(type => {
    switch (type) {
      case 'esp32/temperature': return <FiThermometer />;
      case 'esp32/humidity': return <FiDroplet />;
      case 'esp32/mq135/co2': return <FiWind />;
      case 'esp32/mq5': return <FiAlertCircle />;
      case 'person':
      case 'esp32cam/human_detection': return <FiUser />;
      default: return <FiAlertTriangle />;
    }
  }, []);

  const getAlertColor = useCallback(type => {
    switch (type) {
      case 'esp32/temperature': return '#ff6b81';
      case 'esp32/humidity': return '#1e90ff';
      case 'esp32/mq135/co2': return '#ffa502';
      case 'esp32/mq5': return '#ff4757';
      case 'person':
      case 'esp32cam/human_detection': return '#7d5fff';
      default: return '#2ed573';
    }
  }, []);

  const getActiveAlertsCount = useCallback(() => alerts.filter(alert => !alert.acknowledged).length, [alerts]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), []);
  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => !prev);
    toast.info(`Sound ${!soundEnabled ? 'enabled' : 'disabled'}.`);
  }, [soundEnabled]);
  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    toast.info(`Switched to ${theme === 'dark' ? 'light' : 'dark'} mode.`);
  }, [theme]);
  const toggleMobileMenu = useCallback(() => setMobileMenuOpen(prev => !prev), []);

  const getChartData = useCallback((sensorId) => {
    const labels = sensorHistory[sensorId].map((_, index) => `T${index + 1}`);
    return {
      labels,
      datasets: [
        {
          label: SENSOR_INFO.find(s => s.id === sensorId).name,
          data: sensorHistory[sensorId],
          borderColor: sensorId === 'humidity' ? (sensorData[sensorId] < thresholds[sensorId] && sensorData[sensorId] > 0 ? '#ff4757' : '#1e90ff') :
            sensorData[sensorId] >= thresholds[sensorId] ? '#ff4757' :
            sensorId === 'temperature' ? '#ff6b81' :
            sensorId === 'mq135_co2' ? '#ffa502' :
            sensorId === 'mq5' ? '#ff4757' : '#7d5fff',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          fill: false,
          tension: 0.1,
        },
        {
          label: 'Threshold',
          data: new Array(sensorHistory[sensorId].length).fill(thresholds[sensorId]),
          borderColor: '#666',
          borderDash: [5, 5],
          backgroundColor: 'rgba(0, 0, 0, 0)',
          fill: false,
          tension: 0.1,
        },
      ],
    };
  }, [sensorData, sensorHistory, thresholds]);

  const chartOptions = useCallback((sensorId) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: Math.max(
          ...sensorHistory[sensorId],
          thresholds[sensorId] * 1.2,
          SENSOR_INFO.find(s => s.id === sensorId).max * 0.5
        ),
      },
    },
  }), [sensorHistory, thresholds]);

  const CircularGauge = useCallback(({ value, max, min = 0, threshold, unit, color }) => {
    const safeValue = isNaN(value) || value === null ? min : Math.max(min, Math.min(max, value));
    const percentage = ((safeValue - min) / (max - min)) * 100;
    const isHumidity = unit === '%';
    const isExceeding = isHumidity ? safeValue < threshold && safeValue > 0 : safeValue >= threshold;
    const circumference = 2 * Math.PI * 40;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    return (
      <div className="circular-gauge-container">
        <svg className="circular-gauge" viewBox="0 0 100 100">
          <circle className="gauge-background" cx="50" cy="50" r="40" strokeWidth="8" />
          <circle
            className="gauge-fill"
            cx="50"
            cy="50"
            r="40"
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            stroke={color}
          />
          {threshold && (
            <circle
              className="gauge-threshold"
              cx="50"
              cy="50"
              r="36"
              strokeWidth="2"
              strokeDasharray="5, 5"
              stroke={isExceeding ? '#ff4757' : '#666'}
              transform="rotate(-90 50 50)"
              strokeDashoffset={circumference - ((threshold / max) * 100 / 100) * circumference}
            />
          )}
          <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="gauge-value">
            {safeValue.toFixed(1)}{unit}
          </text>
          <text
            x="50"
            y="65"
            textAnchor="middle"
            dominantBaseline="middle"
            className={`gauge-label ${isExceeding ? 'alert' : ''}`}
          >
            {isExceeding ? 'ALERT' : 'NORMAL'}
          </text>
        </svg>
      </div>
    );
  }, []);

  return (
    <DashboardErrorBoundary navigate={navigate} onReconnect={connectToPaho}>
      <div className={`app-container ${theme}`}>
        <ToastContainer
          position="top-right"
          autoClose={false}
          hideProgressBar={true}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme={theme}
          className="custom-toast-container"
          limit={3}
        />
        <div className="mobile-header">
          <button className="mobile-menu-btn" onClick={toggleMobileMenu}><FiMenu /></button>
          <div className="mobile-title">IoT Guard</div>
          <div className="mobile-user">Hi, {userName}</div>
        </div>
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              className="mobile-menu"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="mobile-menu-header">
                <div className="logo-container">
                  <div className="logo-circle"><FiAlertTriangle className="logo-icon" /></div>
                  <h2>IoT Guard</h2>
                </div>
                <button className="mobile-menu-close" onClick={toggleMobileMenu}><FiX /></button>
              </div>
              <div className="mobile-menu-items">
                <div className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('dashboard'); toggleMobileMenu(); }}>
                  <FiHome /><span>Dashboard</span>
                </div>
                <div className={`menu-item ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => { setActiveTab('alerts'); toggleMobileMenu(); }}>
                  <FiBell /><span>Alerts</span>
                  {getActiveAlertsCount() > 0 && <span className="alert-badge">{getActiveAlertsCount()}</span>}
                </div>
                <div className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); openThresholdModal(); toggleMobileMenu(); }}>
                  <FiSliders /><span>Settings</span>
                </div>
                <div className="menu-item" onClick={handleContactUs}>
                  <FiMail /><span>Contact Us</span>
                </div>
                <div className="helpline-section">
                  <div className="helpline-title">Helpline Numbers</div>
                  <a
                    href="tel:100"
                    className={`helpline-item police ${activeHelpline === 'police' ? 'active' : ''}`}
                    title="Call Police Department"
                    onClick={() => setActiveHelpline('police')}
                  >
                    <FiShield /><span>Police Department: 100</span>
                  </a>
                  <a
                    href="tel:101"
                    className={`helpline-item fire ${activeHelpline === 'fire' ? 'active' : ''}`}
                    title="Call Fire Department"
                    onClick={() => setActiveHelpline('fire')}
                  >
                    <FaFire /><span>Fire Department: 101</span>
                  </a>
                  <a
                    href="tel:108"
                    className={`helpline-item ambulance ${activeHelpline === 'ambulance' ? 'active' : ''}`}
                    title="Call Ambulance"
                    onClick={() => setActiveHelpline('ambulance')}
                  >
                    <FaAmbulance /><span>Ambulance: 108</span>
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!isMobile && (
          <motion.div
            className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="sidebar-header">
              <div className="logo-container">
                <div className="logo-circle"><FiAlertTriangle className="logo-icon" /></div>
                {!sidebarCollapsed && <h2>IoT Guard</h2>}
              </div>
              <button className="sidebar-toggle" onClick={toggleSidebar}>{sidebarCollapsed ? <FiMenu /> : <FiX />}</button>
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="user-welcome">
                  <div className="welcome-text">Welcome back,</div>
                  <div className="username">{userName}</div>
                </div>
                <div className="connection-status">
                  <span className="connection-indicator" style={{ backgroundColor: connectionColor }}></span>
                  <span className="connection-text">{connectionStatus}</span>
                  {connectionStatus.includes('Error') && (
                    <button className="reconnect-btn" onClick={connectToPaho}><FiRefreshCw /> Reconnect</button>
                  )}
                </div>
                <div className="sidebar-menu">
                  <div className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')} title="Dashboard">
                    <FiHome /><span>Dashboard</span>
                  </div>
                  <div className={`menu-item ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')} title="Alerts">
                    <FiBell /><span>Alerts</span>
                    {getActiveAlertsCount() > 0 && <span className="alert-badge">{getActiveAlertsCount()}</span>}
                  </div>
                  <div className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); openThresholdModal(); }} title="Settings">
                    <FiSliders /><span>Settings</span>
                  </div>
                  <div className="menu-item" onClick={handleContactUs} title="Contact Us">
                    <FiMail /><span>Contact Us</span>
                  </div>
                  <div className="helpline-section">
                    <div className="helpline-title">Helpline Numbers</div>
                    <a
                      href="tel:100"
                      className={`helpline-item police ${activeHelpline === 'police' ? 'active' : ''}`}
                      title="Call Police Department"
                      onClick={() => setActiveHelpline('police')}
                    >
                      <FiShield /><span>Police Department: 100</span>
                    </a>
                    <a
                      href="tel:101"
                      className={`helpline-item fire ${activeHelpline === 'fire' ? 'active' : ''}`}
                      title="Call Fire Department"
                      onClick={() => setActiveHelpline('fire')}
                    >
                      <FaFire /><span>Fire Department: 101</span>
                    </a>
                    <a
                      href="tel:108"
                      className={`helpline-item ambulance ${activeHelpline === 'ambulance' ? 'active' : ''}`}
                      title="Call Ambulance"
                      onClick={() => setActiveHelpline('ambulance')}
                    >
                      <FaAmbulance /><span>Ambulance: 108</span>
                    </a>
                  </div>
                </div>
                <div className="sidebar-footer">
                  <div className="last-update"><FiClock /> Last update: {sensorData.lastUpdated || 'N/A'}</div>
                  <div className="sound-control">
                    <button onClick={toggleSound} className="sound-btn">{soundEnabled ? <FiVolume2 /> : <FiVolumeX />}</button>
                    {soundEnabled && (
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={soundVolume}
                        onChange={e => setSoundVolume(parseFloat(e.target.value))}
                      />
                    )}
                  </div>
                  <button onClick={handleLogout} className="logout-btn"><FiLogOut /><span>Logout</span></button>
                </div>
              </>
            )}
          </motion.div>
        )}
        <div className={`main-content ${sidebarCollapsed ? 'expanded' : ''}`} ref={dashboardRef}>
          <div className="content-header">
            <div className="header-left">
              <h1>Dashboard Overview</h1>
              <div className="welcome-message">Welcome back, <span className="username">{userName}</span></div>
            </div>
            <div className="header-actions">
              <motion.button
                onClick={refreshData}
                className="action-btn"
                disabled={isLoading}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Refresh data"
              >
                <FiRefreshCw className={isLoading ? 'spin' : ''} /><span>Refresh</span>
              </motion.button>
              <motion.button
                onClick={exportData}
                className="action-btn"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Export data as CSV"
              >
                <FiDownload /><span>Export Data</span>
              </motion.button>
              <motion.button
                onClick={openThresholdModal}
                className="action-btn"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Adjust sensor thresholds"
              >
                <FiSettings /><span>Thresholds</span>
              </motion.button>
              <motion.button
                onClick={exportDashboardImage}
                className="action-btn"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Export dashboard as image"
              >
                <FiDownload /><span>Export Image</span>
              </motion.button>
            </div>
          </div>
          <AnimatePresence>
            {alerts.some(alert => !alert.acknowledged) && (
              <motion.div
                className="alert-banner"
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <div className="alert-content">
                  <FiAlertTriangle className="alert-icon" />
                  <span>{alerts.find(alert => !alert.acknowledged)?.message}</span>
                  <button
                    className="acknowledge-all-btn"
                    onClick={() => {
                      alerts.forEach(alert => {
                        if (!alert.acknowledged) {
                          const sensorId = SENSOR_INFO.find(s => s.topic === alert.type)?.id || 'human_detection';
                          acknowledgeAlert(alert.id, sensorId);
                        }
                      });
                    }}
                  >
                    <FiCheck /> Acknowledge All
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="sensor-grid">
            {SENSOR_INFO.map(sensor => (
              <motion.div
                key={sensor.id}
                className={`sensor-card ${
                  sensor.id === 'human_detection' && !isHumanDetectionEnabled
                    ? 'disabled'
                    : sensor.id === 'humidity'
                    ? sensorData[sensor.id] < thresholds[sensor.id] && sensorData[sensor.id] > 0
                      ? 'alert'
                      : ''
                    : sensorData[sensor.id] >= thresholds[sensor.id]
                    ? 'alert'
                    : ''
                }`}
                whileHover={{ y: isMobile ? 0 : -5, boxShadow: isMobile ? 'none' : '0 8px 20px rgba(99, 102, 241, 0.3)' }}
                animate={
                  sensor.id === 'human_detection' && !isHumanDetectionEnabled
                    ? {}
                    : (sensor.id === 'humidity'
                        ? sensorData[sensor.id] < thresholds[sensor.id] && sensorData[sensor.id] > 0
                        : sensorData[sensor.id] >= thresholds[sensor.id])
                    ? { scale: [1, 1.02, 1], transition: { repeat: Infinity, duration: 1.5 } }
                    : {}
                }
              >
                <div className="sensor-header">
                  <div className="sensor-icon">{sensor.icon}</div>
                  <h3 className="sensor-label">{sensor.name}</h3>
                </div>
                <div className="sensor-content">
                  {sensor.id === 'human_detection' && !isHumanDetectionEnabled ? (
                    <div className="disabled-message">Human Detection Disabled</div>
                  ) : (
                    <>
                      <div className="sensor-gauge">
                        <CircularGauge
                          value={sensorData[sensor.id]}
                          min={0}
                          max={sensor.max}
                          threshold={thresholds[sensor.id]}
                          unit={sensor.unit}
                          color={
                            sensor.id === 'humidity'
                              ? sensorData[sensor.id] < thresholds[sensor.id] && sensorData[sensor.id] > 0
                                ? '#ff4757'
                                : '#1e90ff'
                              : sensorData[sensor.id] >= thresholds[sensor.id]
                              ? '#ff4757'
                              : sensor.id === 'temperature'
                              ? '#ff6b81'
                              : sensor.id === 'mq135_co2'
                              ? '#ffa502'
                              : sensor.id === 'mq5'
                              ? '#ff4757'
                              : '#7d5fff'
                          }
                        />
                      </div>
                      <div className="sensor-chart">
                        <SensorChart
                          key={`${sensor.id}-${sensorHistory[sensor.id].join('-')}`}
                          sensorId={sensor.id}
                          getChartData={getChartData}
                          chartOptions={chartOptions}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="sensor-footer">
                  <span className="sensor-status">
                    Status:{' '}
                    <span
                      className={
                        sensor.id === 'human_detection' && !isHumanDetectionEnabled
                          ? 'inactive'
                          : sensorStatus[sensor.id]
                          ? 'active'
                          : 'inactive'
                      }
                    >
                      {sensor.id === 'human_detection' && !isHumanDetectionEnabled
                        ? 'Disabled'
                        : sensorStatus[sensor.id]
                        ? 'Active'
                        : 'Inactive'}
                    </span>
                  </span>
                  <span className="sensor-threshold">
                    Threshold: {thresholds[sensor.id]}{sensor.unit}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
          <div className="video-alerts-container">
            <div className="video-feed">
              <div className="section-header"><h3>Live Video Feed</h3></div>
              {streamError ? (
                <div className="stream-error">
                  <FiAlertTriangle /> Failed to load stream
                  <button
                    onClick={() => {
                      setStreamUrl(prev => `${prev.split('?')[0]}?t=${new Date().getTime()}`);
                      setStreamError(false);
                    }}
                    className="retry-btn"
                  >
                    Retry
                  </button>
                </div>
              ) : streamUrl ? (
                <div className={`stream-container ${personDetected ? 'active' : ''}`} style={{ position: 'relative' }}>
                  <img
                    src={`${streamUrl}?t=${Date.now()}`}
                    alt="Live Stream"
                    className="stream-image"
                    onError={(e) => {
                      console.error('Stream error:', e);
                      setStreamError(true);
                    }}
                    style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
                  />
                  {humanDetectionBox && personDetected && (
                    <div
                      className="detection-box"
                      style={{
                        position: 'absolute',
                        top: humanDetectionBox.y,
                        left: humanDetectionBox.x,
                        width: humanDetectionBox.width,
                        height: humanDetectionBox.height,
                        border: '2px solid #ff4757',
                        boxSizing: 'border-box',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        className="confidence-label"
                        style={{
                          position: 'absolute',
                          top: -20,
                          left: 0,
                          background: '#ff4757',
                          color: '#fff',
                          padding: '2px 6px',
                          fontSize: '12px',
                        }}
                      >
                        {Math.round(humanDetectionBox.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="stream-loading">Loading stream...</div>
              )}
            </div>
            <div className="recent-alerts">
              <div className="section-header">
                <h3>Recent Alerts</h3>
                <div className="alerts-header-actions">
                  <span className="alerts-count">{getActiveAlertsCount()} active / {alerts.length} total</span>
                  {alerts.length > 0 && (
                    <motion.button
                      onClick={() => {
                        setAlerts([]);
                        setActiveAlerts({});
                        Object.keys(toastIdsRef.current).forEach(id => toast.dismiss(toastIdsRef.current[id]));
                        toastIdsRef.current = {};
                      }}
                      className="action-btn small danger"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <FiX /> Clear All
                    </motion.button>
                  )}
                </div>
              </div>
              <div className="alerts-list">
                {alerts.length === 0 ? (
                  <div className="no-alerts"><FiCheck className="no-alerts-icon" /><span>No alerts detected</span></div>
                ) : (
                  alerts.slice(0, 5).map(alert => {
                    const sensorId = SENSOR_INFO.find(s => s.topic === alert.type)?.id || 'human_detection';
                    return (
                      <motion.div
                        key={alert.id}
                        className={`alert-item ${alert.acknowledged ? 'acknowledged' : ''}`}
                        style={{ borderLeftColor: getAlertColor(alert.type) }}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                      >
                        <div className="alert-icon">{getSensorIcon(alert.type)}</div>
                        <div className="alert-content">
                          <div className="alert-message">{alert.message}</div>
                          <div className="alert-meta">
                            <span className="alert-time"><FiClock /> {alert.timestamp}</span>
                          </div>
                        </div>
                        {!alert.acknowledged && (
                          <motion.button
                            className="acknowledge-btn"
                            onClick={() => acknowledgeAlert(alert.id, sensorId)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            <FiCheck />
                          </motion.button>
                        )}
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <AnimatePresence>
            {showThresholdModal && (
              <motion.div
                className="modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeThresholdModal}
              >
                <motion.div
                  className="modal-content"
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 50, opacity: 0 }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="modal-header">
                    <h3>Sensor Threshold Settings</h3>
                    <button className="modal-close" onClick={closeThresholdModal}><FiX /></button>
                  </div>
                  <div className="threshold-form">
                    <div className="threshold-input">
                      <label>Human Detection</label>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={isHumanDetectionEnabled}
                          onChange={() => {
                            setIsHumanDetectionEnabled(prev => !prev);
                            toast.info(`Human detection ${!isHumanDetectionEnabled ? 'enabled' : 'disabled'}.`);
                            if (!isHumanDetectionEnabled) {
                              setPersonDetected(false);
                              setHumanDetectionBox(null);
                              setActiveAlerts(prev => ({ ...prev, human_detection: false }));
                              if (toastIdsRef.current.human_detection) {
                                toast.dismiss(toastIdsRef.current.human_detection);
                                delete toastIdsRef.current.human_detection;
                              }
                              setSensorData(prev => ({
                                ...prev,
                                human_detection: 0,
                                lastUpdated: new Date().toLocaleTimeString(),
                              }));
                              setSensorStatus(prev => ({ ...prev, human_detection: false }));
                            }
                          }}
                        />
                        <span className="slider round"></span>
                      </label>
                    </div>
                    {Object.entries(tempThresholds).map(([key, value]) => (
                      <div key={key} className="threshold-input">
                        <label>
                          {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')} Threshold
                          {key === 'human_detection' ? ' (Confidence)' : ` (${key === 'temperature' ? '°C' : key === 'humidity' ? '%' : 'ppm'})`}
                        </label>
                        <input
                          type="number"
                          value={value}
                          onChange={e => setTempThresholds({ ...tempThresholds, [key]: parseFloat(e.target.value) || 0 })}
                          step={key === 'human_detection' || key === 'temperature' || key === 'humidity' ? '0.1' : '1'}
                          min="0"
                          max={key === 'human_detection' ? '1' : undefined}
                          disabled={key === 'human_detection' && !isHumanDetectionEnabled}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="modal-actions">
                    <motion.button
                      className="reset-btn"
                      onClick={resetThresholds}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Reset
                    </motion.button>
                    <motion.button
                      className="cancel-btn"
                      onClick={closeThresholdModal}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      className="save-btn"
                      onClick={saveThresholds}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Save
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </DashboardErrorBoundary>
  );
};

export default Dashboard; 
