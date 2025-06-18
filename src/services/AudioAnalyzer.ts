interface AudioAnalyzerOptions {
  fftSize?: number;
  smoothingTimeConstant?: number;
  maxFrequency?: number;
  minOnsetGap?: number;
  thresholdMultiplier?: number;
  windowSize?: number;
  minTempo?: number;
  maxTempo?: number;
  sensitivity?: number;
  chunkSize?: number;
  onProgress?: (progress: number) => void;
}

interface OnsetData {
  timestamp: number;
  confidence: number;
}

interface BeatData {
  timestamp: number;
  confidence: number;
  tempo: number;
}

interface TempoCandidate {
  tempo: number;
  score: number;
  phase: number;
}

interface AnalysisResults {
  beatCount: number;
  averageTempo: number;
  confidence: number;
  beats: BeatData[];
  metadata: {
    duration: number;
    sampleRate: number;
    channels: number;
    format: string;
    processingTime: number;
  };
}

const SUPPORTED_FORMATS = [
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/aac',
  'audio/m4a',
  'audio/webm',
];

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private frequencyData: Uint8Array | null = null;
  private timeDomainData: Uint8Array | null = null;
  private startTime: number = 0;
  private spectralFluxHistory: number[] = [];
  private onsetHistory: number[] = [];
  private previousSpectrum: Uint8Array | null = null;
  private sensitivity: number = 1.0;
  private beats: BeatData[] = [];
  private isInitialized: boolean = false;
  private maxFrequency: number = 5000;
  private tempoConfidence: number = 0;
  private lastOnsetTime: number = 0;
  private currentTempo: number = 120;
  private algorithm: 'onset' | 'energy' | 'valley' = 'onset';

  // Configuration constants
  private readonly FFT_SIZE: number = 2048;
  private readonly SMOOTHING_TIME_CONSTANT: number = 0.8;
  private readonly WINDOW_SIZE: number = 40;
  private readonly HISTORY_SIZE: number = 100;
  private readonly SMOOTHING_FACTOR: number = 0.8;
  private readonly FLUX_THRESHOLD: number = 0.1;
  private readonly THRESHOLD_MULTIPLIER: number = 1.5;
  private readonly MIN_ONSET_GAP: number = 100;
  private readonly MIN_TEMPO: number = 60;
  private readonly MAX_TEMPO: number = 200;

  constructor(options: AudioAnalyzerOptions = {}) {
    const {
      fftSize = 2048,
      smoothingTimeConstant = 0.8,
      maxFrequency = 5000,
      minOnsetGap = 100,
      thresholdMultiplier = 1.5,
      windowSize = 40,
      minTempo = 60,
      maxTempo = 200,
      sensitivity = 1.0,
      chunkSize,
      onProgress
    } = options;

    this.sensitivity = sensitivity;
    this.maxFrequency = maxFrequency;
    this.initializeContext(fftSize, smoothingTimeConstant);
  }

  private initializeContext(fftSize: number, smoothingTimeConstant: number): void {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContext();
      this.analyserNode = this.audioContext.createAnalyser();
      this.gainNode = this.audioContext.createGain();

      // Configure analyser node
      this.analyserNode.fftSize = fftSize;
      this.analyserNode.smoothingTimeConstant = smoothingTimeConstant;

      // Connect gain node to analyser and destination
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioContext.destination);

      // Initialize frequency data arrays
      this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize AudioAnalyzer:', error);
      this.isInitialized = false;
    }
  }

  private getFrequencyRangeIndices(): { startIndex: number; endIndex: number } {
    if (!this.analyserNode || !this.audioContext) {
      throw new Error('Analyzer not initialized');
    }

    const nyquist = this.audioContext.sampleRate / 2;
    const frequencyBinWidth = nyquist / this.analyserNode.frequencyBinCount;
    
    // Calculate the bin indices for our frequency range of interest
    const startIndex = 0; // Start from 0 Hz
    const endIndex = Math.min(
      Math.floor(this.maxFrequency / frequencyBinWidth),
      this.analyserNode.frequencyBinCount
    );

    return { startIndex, endIndex };
  }

  public getSpectralFlux(): { currentFlux: number; history: number[] } {
    if (!this.analyserNode || !this.frequencyData || !this.timeDomainData) {
      throw new Error('Analyzer not initialized');
    }

    // Get new frequency data
    this.analyserNode.getByteFrequencyData(this.frequencyData);
    this.analyserNode.getByteTimeDomainData(this.timeDomainData);

    const { startIndex, endIndex } = this.getFrequencyRangeIndices();
    let spectralFlux = 0;

    // Calculate spectral flux (difference between current and previous frame)
    for (let i = startIndex; i < endIndex; i++) {
      const diff = (this.frequencyData[i] - this.timeDomainData[i]);
      // Only consider positive changes (increases in energy)
      spectralFlux += diff > 0 ? diff : 0;
    }

    // Normalize by the number of frequency bins
    spectralFlux /= (endIndex - startIndex);

    // Apply smoothing using exponential moving average
    if (this.spectralFluxHistory.length > 0) {
      const lastFlux = this.spectralFluxHistory[this.spectralFluxHistory.length - 1];
      spectralFlux = (this.SMOOTHING_FACTOR * lastFlux) + 
                     ((1 - this.SMOOTHING_FACTOR) * spectralFlux);
    }

    // Update history
    this.spectralFluxHistory.push(spectralFlux);
    if (this.spectralFluxHistory.length > this.HISTORY_SIZE) {
      this.spectralFluxHistory.shift();
    }

    // Store current frequency data as previous for next frame
    this.timeDomainData.set(this.frequencyData);

    return {
      currentFlux: spectralFlux,
      history: [...this.spectralFluxHistory]
    };
  }

  private calculateSpectralFlux(frequencyData: Float32Array): number {
    // Calculate the sum of positive changes in frequency magnitudes
    let flux = 0;
    const binCount = Math.min(
      frequencyData.length,
      Math.floor((this.maxFrequency / (this.audioContext?.sampleRate || 44100)) * frequencyData.length)
    );

    // Compare with previous frame
    for (let i = 0; i < binCount; i++) {
      const diff = frequencyData[i] - (this.timeDomainData?.[i] || -100);
      // Only consider increases in magnitude (positive differences)
      flux += diff > 0 ? diff : 0;
    }

    // Update previous frequency data
    if (!this.timeDomainData) {
      this.timeDomainData = new Uint8Array(frequencyData.length);
    }
    this.timeDomainData.set(frequencyData);

    // Normalize flux
    flux = flux / binCount;

    // Add to history
    this.spectralFluxHistory.push(flux);
    if (this.spectralFluxHistory.length > this.HISTORY_SIZE) {
      this.spectralFluxHistory.shift();
    }

    return flux;
  }

  private detectBeat(flux: number, currentTime: number): boolean {
    // Apply sensitivity to threshold
    const threshold = this.FLUX_THRESHOLD * this.sensitivity;

    // Calculate local average (moving window)
    const localFlux = this.spectralFluxHistory.slice(-this.WINDOW_SIZE);
    const average = localFlux.reduce((a, b) => a + b, 0) / localFlux.length;

    // Check if current flux is a peak and above threshold
    const isPeak = flux > average * this.THRESHOLD_MULTIPLIER;
    const isAboveThreshold = flux > threshold;

    // Check minimum time between onsets
    const timeSinceLastOnset = currentTime - this.lastOnsetTime;
    const meetsTimeConstraint = timeSinceLastOnset > (this.MIN_ONSET_GAP / 1000);

    if (isPeak && isAboveThreshold && meetsTimeConstraint) {
      this.lastOnsetTime = currentTime;
      this.onsetHistory.push(currentTime);
      return true;
    }

    return false;
  }

  public async loadAudioFile(file: File): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      return audioBuffer;
    } catch (error) {
      console.error('Error loading audio file:', error);
      throw new Error('Failed to load audio file');
    }
  }

  public playAudioBuffer(buffer: AudioBuffer): void {
    if (!this.audioContext || !this.analyserNode) {
      console.error('AudioContext not initialized');
      return;
    }

    // Stop any existing playback
    this.stop();

    // Create new source
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = buffer;

    // Connect to gain and analyzer
    this.source.connect(this.gainNode!);
    this.source.connect(this.analyserNode);

    // Start playback
    this.startTime = this.audioContext.currentTime;
    this.source.start(0);
    
    console.log('[AudioAnalyzer] Started audio playback');
  }

  public stop(): void {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (e) {
        // Source might already be stopped
      }
      this.source = null;
    }
    
    // Reset tracking data
    this.spectralFluxHistory = [];
    this.onsetHistory = [];
    this.previousSpectrum = null;
  }

  public resume(): Promise<void> {
    return this.audioContext?.resume() || Promise.resolve();
  }

  public suspend(): Promise<void> {
    return this.audioContext?.suspend() || Promise.resolve();
  }

  public setVolume(value: number): void {
    if (this.gainNode) {
      // Clamp volume between 0 and 1
      const volume = Math.max(0, Math.min(1, value));
      this.gainNode.gain.value = volume;
    }
  }

  public getFrequencyData(): Uint8Array {
    if (!this.analyserNode || !this.frequencyData) {
      throw new Error('Analyser not initialized');
    }

    // Copy frequency data into our array
    this.analyserNode.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  public isContextInitialized(): boolean {
    return this.isInitialized;
  }

  private calculateLocalAverage(values: number[], index: number, windowSize: number): number {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(values.length, index + windowSize + 1);
    const window = values.slice(start, end);
    return window.reduce((sum, val) => sum + val, 0) / window.length;
  }

  private calculateLocalStandardDeviation(values: number[], index: number, windowSize: number, mean: number): number {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(values.length, index + windowSize + 1);
    const window = values.slice(start, end);
    const squaredDiffs = window.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / window.length;
    return Math.sqrt(variance);
  }

  private isPeak(values: number[], index: number): boolean {
    if (index <= 0 || index >= values.length - 1) return false;
    return values[index] > values[index - 1] && values[index] > values[index + 1];
  }

  public findOnsets(): OnsetData[] {
    // For real-time visualization, return beats as onsets
    const beats = this.trackBeats();
    return beats.map(beat => ({
      timestamp: beat.timestamp,
      confidence: beat.confidence
    }));
  }

  public getOnsetTimes(): number[] {
    return this.onsetHistory;
  }

  public getRecentOnsets(duration: number = 2): OnsetData[] {
    if (!this.audioContext) return [];
    
    const currentTime = this.audioContext.currentTime - this.startTime;
    const cutoffTime = currentTime - duration;
    
    return this.onsetHistory.filter(timestamp => timestamp >= cutoffTime).map(timestamp => ({
      timestamp,
      confidence: 0
    }));
  }

  public clearOnsetHistory(): void {
    this.onsetHistory = [];
    this.lastOnsetTime = 0;
  }

  public dispose(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.source = null;
    this.gainNode = null;
    this.frequencyData = null;
    this.timeDomainData = null;
    this.spectralFluxHistory = [];
    this.onsetHistory = [];
    this.beats = [];
    this.isInitialized = false;
  }

  private calculateIntervals(timestamps: number[]): number[] {
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    return intervals;
  }

  private findTempoCandidates(intervals: number[]): TempoCandidate[] {
    if (intervals.length < 2) return [];

    const candidates: TempoCandidate[] = [];
    const histogramBins: { [key: number]: number } = {};

    // Create histogram of tempo candidates
    intervals.forEach(interval => {
      const tempo = Math.round(60 / interval); // Convert interval to BPM
      if (tempo >= this.MIN_TEMPO && tempo <= this.MAX_TEMPO) {
        histogramBins[tempo] = (histogramBins[tempo] || 0) + 1;
      }
    });

    // Convert histogram to candidates
    Object.entries(histogramBins).forEach(([tempo, count]) => {
      const tempoNum = parseInt(tempo);
      candidates.push({
        tempo: tempoNum,
        score: count / intervals.length,
        phase: 0 // Will be calculated later
      });
    });

    return candidates.sort((a, b) => b.score - a.score);
  }

  private calculateBeatPhase(timestamps: number[], tempo: number): number {
    const beatInterval = 60 / tempo;
    let bestPhase = 0;
    let bestScore = 0;

    // Try different phases and find the one that matches the most onsets
    for (let phase = 0; phase < beatInterval; phase += 0.01) {
      let score = 0;
      timestamps.forEach(timestamp => {
        const distanceToBeat = Math.abs((timestamp - phase) % beatInterval);
        if (distanceToBeat < 0.05) { // Within 50ms of the beat
          score++;
        }
      });
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }

    return bestPhase;
  }

  private smoothTempo(newTempo: number): number {
    // Exponential moving average for tempo smoothing
    const TEMPO_SMOOTHING = 0.8;
    return TEMPO_SMOOTHING * this.currentTempo + (1 - TEMPO_SMOOTHING) * newTempo;
  }

  public analyzeTempo(): { tempo: number; confidence: number } {
    const recentOnsets = this.getRecentOnsets(4); // Get last 4 seconds of onsets
    const timestamps = recentOnsets.map(onset => onset.timestamp);
    
    if (timestamps.length < 4) {
      return { tempo: this.currentTempo, confidence: 0 };
    }

    const intervals = this.calculateIntervals(timestamps);
    const candidates = this.findTempoCandidates(intervals);

    if (candidates.length === 0) {
      return { tempo: this.currentTempo, confidence: 0 };
    }

    // Get the top candidate
    const topCandidate = candidates[0];
    
    // Calculate phase for the top tempo candidate
    topCandidate.phase = this.calculateBeatPhase(timestamps, topCandidate.tempo);

    // Update current tempo with smoothing
    this.currentTempo = this.smoothTempo(topCandidate.tempo);
    this.tempoConfidence = topCandidate.score;

    return {
      tempo: this.currentTempo,
      confidence: this.tempoConfidence
    };
  }

  public trackBeats(): BeatData[] {
    // For real-time tracking, return the pre-analyzed beats that fall within the current playback time
    if (!this.source || this.beats.length === 0) return [];
    
    const currentTime = this.audioContext!.currentTime - this.startTime;
    
    // Return beats that are near the current playback time (within 2 seconds)
    return this.beats.filter(beat => 
      beat.timestamp >= currentTime - 2 && 
      beat.timestamp <= currentTime + 2
    );
  }

  public getRecentBeats(duration: number = 2): BeatData[] {
    if (!this.audioContext) return [];
    
    const currentTime = this.audioContext.currentTime - this.startTime;
    const cutoffTime = currentTime - duration;
    
    return this.beats.filter(beat => beat.timestamp >= cutoffTime);
  }

  public getCurrentTempo(): number {
    return this.currentTempo;
  }

  public getTempoConfidence(): number {
    return this.tempoConfidence;
  }

  public clearBeatHistory(resetTempo: boolean = true): void {
    this.beats = [];
    this.tempoConfidence = 0;
    if (resetTempo) {
      this.currentTempo = 120;
    }
  }

  public setSensitivity(value: number): void {
    this.sensitivity = Math.max(0.5, Math.min(2.0, value));
  }

  public setAlgorithm(algorithm: 'onset' | 'energy' | 'valley'): void {
    this.algorithm = algorithm;
    console.log(`[AudioAnalyzer] Algorithm set to: ${algorithm}`);
  }

  public static isFormatSupported(fileType: string): boolean {
    return SUPPORTED_FORMATS.includes(fileType.toLowerCase());
  }

  public static async validateAudioFile(file: File): Promise<{ valid: boolean; error?: string }> {
    if (!this.isFormatSupported(file.type)) {
      return {
        valid: false,
        error: `Unsupported audio format: ${file.type}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
      };
    }

    if (file.size > 100 * 1024 * 1024) { // 100MB limit
      return {
        valid: false,
        error: 'File size too large. Maximum size is 100MB.'
      };
    }

    return { valid: true };
  }

  private async processChunk(
    offlineContext: OfflineAudioContext,
    sourceBuffer: AudioBuffer,
    startSample: number,
    endSample: number
  ): Promise<BeatData[]> {
    const chunkBuffer = this.extractChunk(sourceBuffer, startSample, endSample);
    const chunkSource = offlineContext.createBufferSource();
    const analyzerNode = offlineContext.createAnalyser();
    
    chunkSource.buffer = chunkBuffer;
    chunkSource.connect(analyzerNode);
    analyzerNode.connect(offlineContext.destination);
    
    chunkSource.start(0);
    await offlineContext.startRendering();
    
    return this.detectBeatsInChunk(chunkBuffer, startSample / sourceBuffer.sampleRate);
  }

  private extractChunk(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
    const length = end - start;
    const chunk = new AudioBuffer({
      length,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate
    });

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      chunk.copyToChannel(channelData.slice(start, end), channel);
    }

    return chunk;
  }

  private async detectBeatsInChunk(buffer: AudioBuffer, startTime: number): Promise<BeatData[]> {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    
    console.log('Processing audio chunk:', {
      length: channelData.length,
      duration: channelData.length / sampleRate,
      sampleRate
    });
    
    // Simple but effective onset detection
    const beats = this.detectOnsetsByEnergy(channelData, sampleRate, startTime);
    
    console.log('Detected beats in chunk:', beats.length);
    
    return beats;
  }
  
  private detectOnsetsByEnergy(
    channelData: Float32Array,
    sampleRate: number,
    startTime: number
  ): BeatData[] {
    const beats: BeatData[] = [];
    
    // Parameters
    const windowSize = Math.floor(sampleRate * 0.0116); // ~11.6ms (512 samples at 44.1kHz)
    const hopSize = Math.floor(windowSize / 2);
    const historySize = 43; // ~0.5 seconds of history
    
    // Calculate energy for each window
    const energyValues: number[] = [];
    
    for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
      let energy = 0;
      
      // Calculate RMS energy
      for (let j = 0; j < windowSize; j++) {
        const sample = channelData[i + j];
        energy += sample * sample;
      }
      energy = Math.sqrt(energy / windowSize);
      energyValues.push(energy);
    }
    
    // Smooth energy values
    const smoothedEnergy = this.smoothArray(energyValues, 3);
    
    // Calculate spectral flux (positive differences)
    const spectralFlux: number[] = [0];
    for (let i = 1; i < smoothedEnergy.length; i++) {
      const flux = Math.max(0, smoothedEnergy[i] - smoothedEnergy[i - 1]);
      spectralFlux.push(flux);
    }
    
    // Find peaks using adaptive threshold
    for (let i = historySize; i < spectralFlux.length - 1; i++) {
      // Check if this is a local maximum
      if (spectralFlux[i] > spectralFlux[i - 1] && 
          spectralFlux[i] > spectralFlux[i + 1]) {
        
        // Calculate local statistics
        const history = spectralFlux.slice(i - historySize, i);
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const std = Math.sqrt(
          history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length
        );
        
        // Dynamic threshold
        const threshold = mean + (std * (2.0 - this.sensitivity));
        
        // Check if peak exceeds threshold
        if (spectralFlux[i] > threshold && spectralFlux[i] > 0.001) {
          const timestamp = startTime + (i * hopSize / sampleRate);
          
          // Ensure minimum gap between beats
          if (beats.length === 0 || 
              timestamp - beats[beats.length - 1].timestamp > 0.08) { // 80ms minimum
            
            const confidence = Math.min(1, (spectralFlux[i] - threshold) / threshold);
            
            beats.push({
              timestamp,
              confidence,
              tempo: 0
            });
          }
        }
      }
    }
    
    // Calculate tempo for each beat
    for (let i = 1; i < beats.length; i++) {
      const interval = beats[i].timestamp - beats[i - 1].timestamp;
      beats[i].tempo = 60 / interval;
    }
    
    return beats;
  }
  
  private smoothArray(arr: number[], windowSize: number): number[] {
    const result: number[] = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < arr.length; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - halfWindow); 
           j <= Math.min(arr.length - 1, i + halfWindow); j++) {
        sum += arr[j];
        count++;
      }
      
      result.push(sum / count);
    }
    
    return result;
  }

  public getBeatMetrics(): { energy: number; spectralFlux: number } {
    if (!this.analyserNode || !this.frequencyData) {
      return { energy: 0, spectralFlux: 0 };
    }

    const frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(frequencyData);

    // Calculate current energy in the low-mid frequency range (20-1000Hz)
    const nyquist = this.audioContext!.sampleRate / 2;
    const binFrequency = nyquist / frequencyData.length;
    
    const lowBin = Math.floor(20 / binFrequency);
    const highBin = Math.floor(1000 / binFrequency);
    
    let energy = 0;
    for (let i = lowBin; i <= highBin && i < frequencyData.length; i++) {
      energy += frequencyData[i] / 255;
    }
    energy /= (highBin - lowBin + 1);

    // Calculate spectral flux in the same range
    let spectralFlux = 0;
    if (this.previousSpectrum) {
      for (let i = lowBin; i <= highBin && i < frequencyData.length; i++) {
        const diff = frequencyData[i] - this.previousSpectrum[i];
        if (diff > 0) {
          spectralFlux += diff;
        }
      }
      spectralFlux /= 255 * (highBin - lowBin + 1);
    }

    this.previousSpectrum = new Uint8Array(frequencyData);
    
    // Add to history
    this.spectralFluxHistory.push(spectralFlux);
    if (this.spectralFluxHistory.length > this.WINDOW_SIZE) {
      this.spectralFluxHistory.shift();
    }

    return { energy, spectralFlux };
  }

  public async analyzeAudioBuffer(audioBuffer: AudioBuffer): Promise<{
    beatCount: number;
    averageTempo: number;
    confidence: number;
    beats: Array<{ timestamp: number; confidence: number; tempo: number }>;
  }> {
    switch (this.algorithm) {
      case 'onset':
        return this.analyzeWithOnsetDetection(audioBuffer);
      case 'energy':
        return this.analyzeWithEnergyPeaks(audioBuffer);
      case 'valley':
        return this.analyzeWithValleyToPeak(audioBuffer);
      default:
        return this.analyzeWithOnsetDetection(audioBuffer);
    }
  }

  private async analyzeWithOnsetDetection(audioBuffer: AudioBuffer): Promise<{
    beatCount: number;
    averageTempo: number;
    confidence: number;
    beats: Array<{ timestamp: number; confidence: number; tempo: number }>;
  }> {
    console.log('[AudioAnalyzer] Starting advanced onset detection analysis...');
    
    const offlineContext = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);
    
    const renderedBuffer = await offlineContext.startRendering();
    const channelData = renderedBuffer.getChannelData(0);
    const sampleRate = renderedBuffer.sampleRate;
    
    // Parameters
    const frameSize = 2048;
    const hopSize = 512;
    const numFrames = Math.floor((channelData.length - frameSize) / hopSize);
    
    // Onset detection functions
    const spectralFlux: number[] = [];
    const highFrequencyContent: number[] = [];
    const spectralCentroid: number[] = [];
    let previousMagnitudes: number[] = new Array(frameSize / 2).fill(0);
    
    // Process each frame
    for (let frame = 0; frame < numFrames; frame++) {
      const startSample = frame * hopSize;
      
      // Extract frame and apply window
      const frameData = new Float32Array(frameSize);
      for (let i = 0; i < frameSize; i++) {
        const windowValue = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frameSize - 1)); // Hann window
        frameData[i] = (channelData[startSample + i] || 0) * windowValue;
      }
      
      // Compute FFT (simplified - in production, use a proper FFT library)
      const fft = this.computeFFT(frameData);
      const magnitudes = new Array(fft.length / 2);
      
      for (let i = 0; i < magnitudes.length; i++) {
        const real = fft[i * 2];
        const imag = fft[i * 2 + 1];
        magnitudes[i] = Math.sqrt(real * real + imag * imag);
      }
      
      // 1. Spectral Flux (with emphasis on onsets)
      let flux = 0;
      for (let i = 0; i < magnitudes.length; i++) {
        const diff = magnitudes[i] - previousMagnitudes[i];
        if (diff > 0) {
          // Weight higher frequencies more (they indicate transients)
          const weight = 1 + (i / magnitudes.length);
          flux += diff * weight;
        }
      }
      spectralFlux.push(flux);
      
      // 2. High Frequency Content (indicates transients)
      let hfc = 0;
      for (let i = magnitudes.length / 2; i < magnitudes.length; i++) {
        hfc += magnitudes[i] * i;
      }
      highFrequencyContent.push(hfc);
      
      // 3. Spectral Centroid (brightness indicator)
      let weightedSum = 0;
      let magnitudeSum = 0;
      for (let i = 0; i < magnitudes.length; i++) {
        weightedSum += i * magnitudes[i];
        magnitudeSum += magnitudes[i];
      }
      const centroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
      spectralCentroid.push(centroid);
      
      previousMagnitudes = [...magnitudes];
    }
    
    // Normalize features
    const normalizeArray = (arr: number[]) => {
      const max = Math.max(...arr);
      return max > 0 ? arr.map(v => v / max) : arr;
    };
    
    const normalizedFlux = normalizeArray(spectralFlux);
    const normalizedHFC = normalizeArray(highFrequencyContent);
    const normalizedCentroid = normalizeArray(spectralCentroid);
    
    // Combine onset detection functions
    const onsetStrength: number[] = [];
    for (let i = 0; i < normalizedFlux.length; i++) {
      // Weighted combination of features
      const strength = (
        normalizedFlux[i] * 0.5 +          // Main contributor
        normalizedHFC[i] * 0.3 +           // Transient emphasis
        normalizedCentroid[i] * 0.2        // Brightness changes
      );
      onsetStrength.push(strength);
    }
    
    // Apply adaptive threshold
    const beats: Array<{ timestamp: number; confidence: number; tempo: number }> = [];
    const windowLength = Math.floor(sampleRate / hopSize); // 1 second window
    const minPeakDistance = Math.floor(0.3 * sampleRate / hopSize); // 300ms minimum
    
    for (let i = 1; i < onsetStrength.length - 1; i++) {
      // Check if this is a local peak
      if (onsetStrength[i] > onsetStrength[i - 1] && 
          onsetStrength[i] > onsetStrength[i + 1]) {
        
        // Calculate local statistics
        const windowStart = Math.max(0, i - windowLength);
        const windowEnd = Math.min(onsetStrength.length, i + windowLength);
        const localValues = onsetStrength.slice(windowStart, windowEnd);
        
        const mean = localValues.reduce((a, b) => a + b, 0) / localValues.length;
        const variance = localValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / localValues.length;
        const stdDev = Math.sqrt(variance);
        
        // Adaptive threshold based on sensitivity
        const thresholdMultiplier = 3.0 - this.sensitivity; // 1.0 to 2.0
        const threshold = mean + (stdDev * thresholdMultiplier);
        
        if (onsetStrength[i] > threshold) {
          // Check minimum distance from last beat
          const timestamp = (i * hopSize) / sampleRate;
          const lastBeat = beats[beats.length - 1];
          
          if (!lastBeat || (timestamp - lastBeat.timestamp) >= 0.3) {
            // Calculate confidence based on peak prominence
            const prominence = (onsetStrength[i] - mean) / stdDev;
            const confidence = Math.min(1, prominence / 3);
            
            beats.push({
              timestamp,
              confidence,
              tempo: 0
            });
          }
        }
      }
    }
    
    // Post-processing: Remove weak beats if we have too many
    if (beats.length > 20) {
      beats.sort((a, b) => b.confidence - a.confidence);
      beats.splice(20); // Keep only top 20
      beats.sort((a, b) => a.timestamp - b.timestamp);
    }
    
    // Calculate tempo
    for (let i = 1; i < beats.length; i++) {
      const interval = beats[i].timestamp - beats[i - 1].timestamp;
      const tempo = 60 / interval;
      beats[i].tempo = Math.round(tempo);
    }
    
    const averageTempo = beats.length > 1
      ? beats.slice(1).reduce((sum, b) => sum + b.tempo, 0) / (beats.length - 1)
      : 120;
    
    const overallConfidence = beats.length > 0
      ? beats.reduce((sum, b) => sum + b.confidence, 0) / beats.length
      : 0;
    
    console.log(`[AudioAnalyzer] Onset detection complete: ${beats.length} beats detected`);
    console.log(`[AudioAnalyzer] Average tempo: ${averageTempo.toFixed(1)} BPM`);
    console.log(`[AudioAnalyzer] Sensitivity: ${this.sensitivity}`);
    
    this.beats = beats;
    
    return {
      beatCount: beats.length,
      averageTempo: Math.round(averageTempo),
      confidence: overallConfidence,
      beats
    };
  }

  private async analyzeWithEnergyPeaks(audioBuffer: AudioBuffer): Promise<{
    beatCount: number;
    averageTempo: number;
    confidence: number;
    beats: Array<{ timestamp: number; confidence: number; tempo: number }>;
  }> {
    console.log('[AudioAnalyzer] Starting energy-based peak detection...');
    
    const offlineContext = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    // Apply low-pass filter for bass frequencies
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    
    const lowPassFilter = offlineContext.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 200; // Focus on bass
    lowPassFilter.Q.value = 1;

    source.connect(lowPassFilter);
    lowPassFilter.connect(offlineContext.destination);
    source.start(0);
    
    const renderedBuffer = await offlineContext.startRendering();
    const channelData = renderedBuffer.getChannelData(0);
    const sampleRate = renderedBuffer.sampleRate;
    
    // Calculate energy in windows
    const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
    const hopSize = Math.floor(windowSize / 2);
    const energy: number[] = [];
    
    for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
      let sum = 0;
      for (let j = 0; j < windowSize; j++) {
        const sample = channelData[i + j];
        sum += sample * sample;
      }
      energy.push(Math.sqrt(sum / windowSize));
    }
    
    // Find peaks using dynamic threshold
    const beats: Array<{ timestamp: number; confidence: number; tempo: number }> = [];
    const windowLength = Math.floor(1.5 * sampleRate / hopSize); // 1.5 second window
    
    for (let i = 1; i < energy.length - 1; i++) {
      // Check if this is a local peak
      if (energy[i] > energy[i - 1] && energy[i] > energy[i + 1]) {
        // Calculate local statistics
        const windowStart = Math.max(0, i - windowLength);
        const windowEnd = Math.min(energy.length, i + windowLength);
        const localEnergy = energy.slice(windowStart, windowEnd);
        
        const mean = localEnergy.reduce((a, b) => a + b, 0) / localEnergy.length;
        const variance = localEnergy.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / localEnergy.length;
        const stdDev = Math.sqrt(variance);
        
        // Dynamic threshold based on sensitivity
        const thresholdMultiplier = 3.5 - (this.sensitivity * 1.5); // 2.0 to 0.5
        const threshold = mean + (stdDev * thresholdMultiplier);
        
        if (energy[i] > threshold) {
          const timestamp = (i * hopSize) / sampleRate;
          const lastBeat = beats[beats.length - 1];
          
          // Minimum 250ms between beats
          if (!lastBeat || (timestamp - lastBeat.timestamp) >= 0.25) {
            const prominence = (energy[i] - mean) / stdDev;
            const confidence = Math.min(1, prominence / 4);
            
            beats.push({
              timestamp,
              confidence,
              tempo: 0
            });
          }
        }
      }
    }
    
    // Calculate tempo
    for (let i = 1; i < beats.length; i++) {
      const interval = beats[i].timestamp - beats[i - 1].timestamp;
      const tempo = 60 / interval;
      beats[i].tempo = Math.round(tempo);
    }
    
    const averageTempo = beats.length > 1
      ? beats.slice(1).reduce((sum, b) => sum + b.tempo, 0) / (beats.length - 1)
      : 120;
    
    const overallConfidence = beats.length > 0
      ? beats.reduce((sum, b) => sum + b.confidence, 0) / beats.length
      : 0;
    
    console.log(`[AudioAnalyzer] Energy peak detection complete: ${beats.length} beats detected`);
    
    this.beats = beats;
    
    return {
      beatCount: beats.length,
      averageTempo: Math.round(averageTempo),
      confidence: overallConfidence,
      beats
    };
  }

  private async analyzeWithValleyToPeak(audioBuffer: AudioBuffer): Promise<{
    beatCount: number;
    averageTempo: number;
    confidence: number;
    beats: Array<{ timestamp: number; confidence: number; tempo: number }>;
  }> {
    console.log('[AudioAnalyzer] Starting valley-to-peak beat analysis...');
    
    const offlineContext = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    // Create filters for low and mid frequencies (20-1000 Hz)
    const lowPassFilter = offlineContext.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 1000;
    lowPassFilter.Q.value = 1;

    const highPassFilter = offlineContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 20;
    highPassFilter.Q.value = 1;

    // Connect the audio graph
    source.connect(highPassFilter);
    highPassFilter.connect(lowPassFilter);
    lowPassFilter.connect(offlineContext.destination);

    source.start(0);
    const renderedBuffer = await offlineContext.startRendering();
    
    // Get the filtered audio data
    const channelData = renderedBuffer.getChannelData(0);
    const sampleRate = renderedBuffer.sampleRate;
    
    // Calculate amplitude envelope with a sliding window
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms window
    const envelope: number[] = [];
    
    for (let i = 0; i < channelData.length; i += windowSize) {
      let sum = 0;
      let count = 0;
      for (let j = i; j < Math.min(i + windowSize, channelData.length); j++) {
        sum += Math.abs(channelData[j]);
        count++;
      }
      envelope.push(sum / count);
    }
    
    // Calculate average amplitude for threshold
    const avgAmplitude = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const valleyThreshold = avgAmplitude * 0.2; // 20% of average
    
    // Find valleys and subsequent peaks
    const beats: Array<{ timestamp: number; confidence: number; tempo: number }> = [];
    const peakDetectionWindow = Math.floor(150 / (1000 / sampleRate * windowSize)); // 150ms in envelope samples
    const minBeatSpacing = Math.floor(300 / (1000 / sampleRate * windowSize)); // 300ms in envelope samples
    
    let lastBeatIndex = -minBeatSpacing;
    
    for (let i = 1; i < envelope.length - peakDetectionWindow - 1; i++) {
      // Skip if too close to last beat
      if (i - lastBeatIndex < minBeatSpacing) continue;
      
      // Check if this is a valley (local minimum below threshold)
      const isValley = envelope[i] < valleyThreshold &&
                      envelope[i] <= envelope[i - 1] &&
                      envelope[i] <= envelope[i + 1];
      
      if (isValley) {
        // Look for peak in the next 150ms window
        let maxPeakValue = envelope[i];
        let maxPeakIndex = i;
        
        for (let j = i + 1; j <= Math.min(i + peakDetectionWindow, envelope.length - 1); j++) {
          if (envelope[j] > maxPeakValue) {
            maxPeakValue = envelope[j];
            maxPeakIndex = j;
          }
        }
        
        // Check if peak is high enough based on sensitivity
        const peakToValleyRatio = maxPeakValue / (envelope[i] + 0.001);
        const requiredRatio = 3.5 - this.sensitivity; // 2.5 to 1.5
        
        if (peakToValleyRatio >= requiredRatio && maxPeakIndex > i) {
          // Calculate timestamp for the peak
          const timestamp = (maxPeakIndex * windowSize) / sampleRate;
          
          // Calculate confidence
          const prominence = maxPeakValue / avgAmplitude;
          const confidence = Math.min(1, (peakToValleyRatio - requiredRatio) / requiredRatio * 0.5 + prominence * 0.5);
          
          beats.push({
            timestamp,
            confidence,
            tempo: 0
          });
          
          lastBeatIndex = maxPeakIndex;
          i = maxPeakIndex;
        }
      }
    }
    
    // Calculate tempo
    for (let i = 1; i < beats.length; i++) {
      const interval = beats[i].timestamp - beats[i - 1].timestamp;
      const tempo = 60 / interval;
      beats[i].tempo = Math.round(tempo);
    }
    
    const averageTempo = beats.length > 1
      ? beats.slice(1).reduce((sum, b) => sum + b.tempo, 0) / (beats.length - 1)
      : 120;
    
    const overallConfidence = beats.length > 0
      ? beats.reduce((sum, b) => sum + b.confidence, 0) / beats.length
      : 0;
    
    console.log(`[AudioAnalyzer] Valley-to-peak analysis complete: ${beats.length} beats detected`);
    
    this.beats = beats;
    
    return {
      beatCount: beats.length,
      averageTempo: Math.round(averageTempo),
      confidence: overallConfidence,
      beats
    };
  }

  // Simple FFT implementation (for demonstration - in production use a library)
  private computeFFT(data: Float32Array): number[] {
    const N = data.length;
    const output = new Array(N * 2).fill(0);
    
    // This is a naive DFT implementation - for production, use FFT.js or similar
    for (let k = 0; k < N / 2; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += data[n] * Math.cos(angle);
        imag += data[n] * Math.sin(angle);
      }
      
      output[k * 2] = real;
      output[k * 2 + 1] = imag;
    }
    
    return output;
  }
} 