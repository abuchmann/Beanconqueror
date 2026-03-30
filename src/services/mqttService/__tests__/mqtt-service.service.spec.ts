import { CustomInformationBrew } from '../../../classes/brew/customInformationBrew';
import { Settings } from '../../../classes/settings/settings';
import { MqttService } from '../mqtt-service.service';

describe('MqttService', () => {
  let service: MqttService;
  let mockClient: {
    publishAsync: jasmine.Spy;
    endAsync: jasmine.Spy;
  };
  let mockUIBrewStorage: {
    getAllEntries: jasmine.Spy;
    update: jasmine.Spy;
  };
  let mockUIBeanStorage: {
    getAllEntries: jasmine.Spy;
  };
  let mockUISettingsStorage: {
    getSettings: jasmine.Spy;
  };
  let mockUIToast: {
    showInfoToastBottom: jasmine.Spy;
  };
  let mockUILog: {
    info: jasmine.Spy;
    error: jasmine.Spy;
  };
  let mockSettings: Settings;

  function createMockBrew(overrides: Record<string, any> = {}) {
    return {
      config: { uuid: 'brew-1', unix_timestamp: 1711800000 },
      customInformation: new CustomInformationBrew(),
      grind_size: '15',
      grind_weight: 18,
      brew_temperature: 93,
      brew_time: 30,
      brew_time_milliseconds: 30000,
      brew_quantity: 36,
      brew_quantity_type: 0,
      brew_beverage_quantity: 36,
      tds: 1.35,
      rating: 4,
      note: 'Good shot',
      favourite: false,
      best_brew: false,
      getBean: () => ({
        name: 'Ethiopia Yirgacheffe',
        roaster: 'Local Roasters',
        roast: 'LIGHT',
        roastingDate: '2025-03-01',
      }),
      getPreparation: () => ({
        name: 'V60',
        type: 'V60',
        style_type: 'POUR_OVER',
      }),
      getMill: () => ({ name: 'Comandante C40' }),
      getWater: () => ({ name: 'Third Wave Water' }),
      getBrewRatio: () => '1 / 2.00',
      ...overrides,
    };
  }

  function createMockBean(overrides: Record<string, any> = {}) {
    return {
      name: 'Ethiopia Yirgacheffe',
      roaster: 'Local Roasters',
      roastingDate: '2025-03-01',
      weight: 250,
      rating: 4,
      finished: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockClient = {
      publishAsync: jasmine.createSpy('publishAsync').and.returnValue(Promise.resolve()),
      endAsync: jasmine.createSpy('endAsync').and.returnValue(Promise.resolve()),
    };

    mockSettings = new Settings();
    mockSettings.mqtt_active = true;
    mockSettings.mqtt_url = 'ws://localhost:9001';
    mockSettings.mqtt_username = 'testuser';
    mockSettings.mqtt_password = 'testpass';
    mockSettings.mqtt_topic_prefix = 'beanconqueror';
    mockSettings.mqtt_publish_automatic = true;
    mockSettings.mqtt_publish_recent_brews_count = 5;

    mockUISettingsStorage = {
      getSettings: jasmine.createSpy('getSettings').and.returnValue(mockSettings),
    };
    mockUIBrewStorage = {
      getAllEntries: jasmine.createSpy('getAllEntries').and.returnValue([]),
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve()),
    };
    mockUIBeanStorage = {
      getAllEntries: jasmine.createSpy('getAllEntries').and.returnValue([]),
    };
    mockUIToast = {
      showInfoToastBottom: jasmine.createSpy('showInfoToastBottom'),
    };
    mockUILog = {
      info: jasmine.createSpy('info'),
      error: jasmine.createSpy('error'),
    };

    // Create service without TestBed (same pattern as cloud-field-extraction tests)
    service = Object.create(MqttService.prototype);
    (service as any).uiSettingsStorage = mockUISettingsStorage;
    (service as any).uiBrewStorage = mockUIBrewStorage;
    (service as any).uiBeanStorage = mockUIBeanStorage;
    (service as any).uiToast = mockUIToast;
    (service as any).uiLog = mockUILog;

    // Spy on the private connect() method to avoid real MQTT connections
    spyOn(service as any, 'connect').and.returnValue(
      Promise.resolve(mockClient as any),
    );
  });

  // ── checkConnection ─────────────────────────────────────────────────

  describe('checkConnection', () => {
    it('should return true when broker is reachable', async () => {
      const result = await service.checkConnection();

      expect(result).toBeTrue();
      expect((service as any).connect).toHaveBeenCalled();
      expect(mockClient.publishAsync).toHaveBeenCalledWith(
        'beanconqueror/status',
        'online',
        { retain: true, qos: 1 },
      );
      expect(mockClient.endAsync).toHaveBeenCalled();
    });

    it('should return false when broker is unreachable', async () => {
      (service as any).connect.and.returnValue(
        Promise.reject(new Error('Connection refused')),
      );

      const result = await service.checkConnection();

      expect(result).toBeFalse();
      expect(mockUILog.error).toHaveBeenCalled();
    });

    it('should use custom topic prefix from settings', async () => {
      mockSettings.mqtt_topic_prefix = 'mycoffee';

      await service.checkConnection();

      expect(mockClient.publishAsync).toHaveBeenCalledWith(
        'mycoffee/status',
        'online',
        jasmine.any(Object),
      );
    });
  });

  // ── publishBrewData ─────────────────────────────────────────────────

  describe('publishBrewData', () => {
    it('should publish brew to latest topic with retain', async () => {
      const brew = createMockBrew();

      await service.publishBrewData(brew as any);

      expect(mockClient.publishAsync).toHaveBeenCalledWith(
        'beanconqueror/brew/latest',
        jasmine.any(String),
        { retain: true, qos: 1 },
      );

      // Verify payload content
      const publishedPayload = JSON.parse(
        mockClient.publishAsync.calls.argsFor(0)[1],
      );
      expect(publishedPayload.bean_name).toBe('Ethiopia Yirgacheffe');
      expect(publishedPayload.preparation_name).toBe('V60');
      expect(publishedPayload.grind_weight).toBe(18);
      expect(publishedPayload.ratio).toBe('1 / 2.00');
    });

    it('should mark brew as mqtt_published after successful publish', async () => {
      const brew = createMockBrew();

      await service.publishBrewData(brew as any);

      expect(brew.customInformation.mqtt_published).toBeTrue();
      expect(mockUIBrewStorage.update).toHaveBeenCalledWith(brew);
    });

    it('should NOT mark brew as published when connection fails', async () => {
      (service as any).connect.and.returnValue(
        Promise.reject(new Error('Connection refused')),
      );
      const brew = createMockBrew();

      await service.publishBrewData(brew as any);

      expect(brew.customInformation.mqtt_published).toBeFalse();
      expect(mockUILog.error).toHaveBeenCalled();
    });

    it('should disconnect after publishing', async () => {
      const brew = createMockBrew();

      await service.publishBrewData(brew as any);

      expect(mockClient.endAsync).toHaveBeenCalled();
    });

    it('should publish recent brews and active beans alongside the brew', async () => {
      const brew = createMockBrew();
      mockUIBeanStorage.getAllEntries.and.returnValue([
        createMockBean(),
        createMockBean({ name: 'Colombia', finished: true }),
      ]);

      await service.publishBrewData(brew as any);

      // Should publish to brews/recent
      const recentCall = mockClient.publishAsync.calls.all().find(
        (c: any) => c.args[0] === 'beanconqueror/brews/recent',
      );
      expect(recentCall).toBeTruthy();

      // Should publish to beans/active (only non-finished)
      const beansCall = mockClient.publishAsync.calls.all().find(
        (c: any) => c.args[0] === 'beanconqueror/beans/active',
      );
      expect(beansCall).toBeTruthy();
      const beansPayload = JSON.parse(beansCall.args[1]);
      expect(beansPayload.length).toBe(1);
      expect(beansPayload[0].name).toBe('Ethiopia Yirgacheffe');
    });
  });

  // ── Payload mapping ─────────────────────────────────────────────────

  describe('payload mapping', () => {
    it('should handle null bean/prep/mill/water gracefully', async () => {
      const brew = createMockBrew({
        getBean: () => null,
        getPreparation: () => null,
        getMill: () => null,
        getWater: () => null,
        getBrewRatio: () => '1 / ?',
      });

      await service.publishBrewData(brew as any);

      const payload = JSON.parse(
        mockClient.publishAsync.calls.argsFor(0)[1],
      );
      expect(payload.bean_name).toBe('');
      expect(payload.preparation_name).toBe('');
      expect(payload.mill_name).toBe('');
      expect(payload.water_name).toBe('');
    });

    it('should format brew_date as ISO timestamp', async () => {
      const brew = createMockBrew({
        config: { uuid: 'brew-1', unix_timestamp: 1711800000 },
      });

      await service.publishBrewData(brew as any);

      const payload = JSON.parse(
        mockClient.publishAsync.calls.argsFor(0)[1],
      );
      expect(payload.brew_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── Catch-up logic ──────────────────────────────────────────────────

  describe('catch-up logic', () => {
    it('should publish previously unpublished brews on successful connection', async () => {
      const currentBrew = createMockBrew({ config: { uuid: 'brew-new', unix_timestamp: 1711800100 } });
      const pendingBrew = createMockBrew({ config: { uuid: 'brew-old', unix_timestamp: 1711800000 } });
      pendingBrew.customInformation.mqtt_published = false;

      mockUIBrewStorage.getAllEntries.and.returnValue([pendingBrew]);

      await service.publishBrewData(currentBrew as any);

      // Should have published the pending brew to its own topic
      const pendingCall = mockClient.publishAsync.calls.all().find(
        (c: any) => c.args[0] === 'beanconqueror/brew/brew-old',
      );
      expect(pendingCall).toBeTruthy();
      expect(pendingBrew.customInformation.mqtt_published).toBeTrue();
    });

    it('should skip already-published brews during catch-up', async () => {
      const currentBrew = createMockBrew({ config: { uuid: 'brew-new', unix_timestamp: 1711800100 } });
      const publishedBrew = createMockBrew({ config: { uuid: 'brew-done', unix_timestamp: 1711800000 } });
      publishedBrew.customInformation.mqtt_published = true;

      mockUIBrewStorage.getAllEntries.and.returnValue([publishedBrew]);

      await service.publishBrewData(currentBrew as any);

      const catchupCall = mockClient.publishAsync.calls.all().find(
        (c: any) => c.args[0] === 'beanconqueror/brew/brew-done',
      );
      expect(catchupCall).toBeUndefined();
    });

    it('should continue catch-up if one brew fails to publish', async () => {
      const currentBrew = createMockBrew({ config: { uuid: 'brew-new', unix_timestamp: 1711800200 } });
      const failBrew = createMockBrew({ config: { uuid: 'brew-fail', unix_timestamp: 1711800000 } });
      const okBrew = createMockBrew({ config: { uuid: 'brew-ok', unix_timestamp: 1711800100 } });

      mockUIBrewStorage.getAllEntries.and.returnValue([failBrew, okBrew]);

      let callCount = 0;
      mockClient.publishAsync.and.callFake((topic: string) => {
        if (topic === 'beanconqueror/brew/brew-fail') {
          return Promise.reject(new Error('Publish failed'));
        }
        return Promise.resolve();
      });

      await service.publishBrewData(currentBrew as any);

      // Failed brew should NOT be marked as published
      expect(failBrew.customInformation.mqtt_published).toBeFalse();
      // Successful brew should be marked as published
      expect(okBrew.customInformation.mqtt_published).toBeTrue();
    });
  });

  // ── howManyBrewsAreNotPublishedToMqtt ───────────────────────────────

  describe('howManyBrewsAreNotPublishedToMqtt', () => {
    it('should return 0 when all brews are published', () => {
      const brew1 = createMockBrew();
      brew1.customInformation.mqtt_published = true;
      const brew2 = createMockBrew();
      brew2.customInformation.mqtt_published = true;
      mockUIBrewStorage.getAllEntries.and.returnValue([brew1, brew2]);

      expect(service.howManyBrewsAreNotPublishedToMqtt()).toBe(0);
    });

    it('should return correct count of unpublished brews', () => {
      const published = createMockBrew();
      published.customInformation.mqtt_published = true;
      const unpublished1 = createMockBrew();
      const unpublished2 = createMockBrew();
      mockUIBrewStorage.getAllEntries.and.returnValue([
        published,
        unpublished1,
        unpublished2,
      ]);

      expect(service.howManyBrewsAreNotPublishedToMqtt()).toBe(2);
    });

    it('should handle brews with missing customInformation', () => {
      const brew = createMockBrew({ customInformation: undefined });
      mockUIBrewStorage.getAllEntries.and.returnValue([brew]);

      expect(service.howManyBrewsAreNotPublishedToMqtt()).toBe(1);
    });
  });

  // ── publishAllUnpublished ───────────────────────────────────────────

  describe('publishAllUnpublished', () => {
    it('should show success toast on successful publish', async () => {
      await service.publishAllUnpublished();

      expect(mockUIToast.showInfoToastBottom).toHaveBeenCalledWith(
        'MQTT.PUBLISH.SUCCESSFULLY',
      );
      expect(mockClient.endAsync).toHaveBeenCalled();
    });

    it('should show error toast when connection fails', async () => {
      (service as any).connect.and.returnValue(
        Promise.reject(new Error('Connection refused')),
      );

      await service.publishAllUnpublished();

      expect(mockUIToast.showInfoToastBottom).toHaveBeenCalledWith(
        'MQTT.PUBLISH.UNSUCCESSFULLY',
      );
    });
  });
});
