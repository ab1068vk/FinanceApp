import { DEVICE_SECURITY_WARNING, detectDeviceSecurityRisk } from '../deviceSecurity';

describe('detectDeviceSecurityRisk', () => {
  it('records a security event when the root detection library reports compromise', async () => {
    const report = jest.fn().mockResolvedValue(undefined);

    const result = await detectDeviceSecurityRisk({
      platform: 'android',
      device: { isDevice: true, deviceName: 'Pixel 7' },
      jailMonkey: {
        isJailBroken: () => true,
        jailBrokenMessage: () => 'su binary found',
      },
      report,
    });

    expect(result).toEqual({
      insecure: true,
      findings: ['root_or_jailbreak'],
      userMessage: DEVICE_SECURITY_WARNING,
    });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Potential insecure device detected',
      screen: 'startup',
      platform: 'android',
      type: 'security',
      metadata: expect.objectContaining({
        findings: ['root_or_jailbreak'],
        deviceName: 'Pixel 7',
        jailBrokenMessage: 'su binary found',
      }),
    }));
  });

  it('keeps emulator detection separate from root and jailbreak findings', async () => {
    const report = jest.fn().mockResolvedValue(undefined);

    const result = await detectDeviceSecurityRisk({
      platform: 'ios',
      device: { isDevice: false, deviceName: 'iPhone Simulator' },
      jailMonkey: { isJailBroken: () => false },
      report,
    });

    expect(result.insecure).toBe(true);
    expect(result.findings).toEqual(['emulator']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ findings: ['emulator'] }),
    }));
  });

  it('does not record a security event when no signals are present', async () => {
    const report = jest.fn().mockResolvedValue(undefined);

    const result = await detectDeviceSecurityRisk({
      platform: 'android',
      device: { isDevice: true, deviceName: 'Pixel 7' },
      jailMonkey: { isJailBroken: () => false, hookDetected: () => false },
      report,
    });

    expect(result).toEqual({ insecure: false, findings: [], userMessage: '' });
    expect(report).not.toHaveBeenCalled();
  });
});
