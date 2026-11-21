Pod::Spec.new do |s|
  s.name = 'T3PreviewTunnel'
  s.version = '1.0.0'
  s.summary = 'Webview whose localhost is another T3 Code environment.'
  s.description = "Loads an environment's loopback pages on the device through the server's preview tunnel, keeping their localhost origin."
  s.author = 'T3 Tools'
  s.homepage = 'https://t3tools.com'
  # Fork: The iOS 17 app cannot link a pod raised to 18.0; ProxyConfiguration and WKWebsiteDataStore.proxyConfigurations are iOS 17.0.
  s.platform = :ios, '17.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end
