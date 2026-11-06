Pod::Spec.new do |s|
  s.name = 'T3VoiceTranscription'
  s.version = '1.0.0'
  s.summary = 'Local recording conversion for T3 Code dictation.'
  s.author = 'T3 Tools'
  s.homepage = 'https://t3tools.com'
  # Fork: The app targets iOS 17 and this module only uses AudioToolbox; drop when the fork stops supporting iOS 17.
  s.platform = :ios, '17.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'AudioToolbox'
end
