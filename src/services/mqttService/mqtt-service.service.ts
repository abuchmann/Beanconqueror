import { inject, Injectable } from '@angular/core';
import mqtt from 'mqtt';

import { Brew } from '../../classes/brew/brew';
import { Settings } from '../../classes/settings/settings';
import { UIBeanStorage } from '../uiBeanStorage';
import { UIBrewStorage } from '../uiBrewStorage';
import { UILog } from '../uiLog';
import { UISettingsStorage } from '../uiSettingsStorage';
import { UIToast } from '../uiToast';

@Injectable({
  providedIn: 'root',
})
export class MqttService {
  private readonly uiToast = inject(UIToast);
  private readonly uiBrewStorage = inject(UIBrewStorage);
  private readonly uiBeanStorage = inject(UIBeanStorage);
  private readonly uiSettingsStorage = inject(UISettingsStorage);
  private readonly uiLog = inject(UILog);

  private async connect(): Promise<mqtt.MqttClient> {
    const settings: Settings = this.uiSettingsStorage.getSettings();
    const prefix = settings.mqtt_topic_prefix || 'beanconqueror';

    const client = await mqtt.connectAsync(settings.mqtt_url, {
      username: settings.mqtt_username || undefined,
      password: settings.mqtt_password || undefined,
      connectTimeout: 5000,
      clean: true,
      will: {
        topic: `${prefix}/status`,
        payload: Buffer.from('offline'),
        retain: true,
        qos: 1,
      },
    });
    return client;
  }

  public async checkConnection(): Promise<boolean> {
    try {
      const settings: Settings = this.uiSettingsStorage.getSettings();
      const prefix = settings.mqtt_topic_prefix || 'beanconqueror';
      const client = await this.connect();
      await client.publishAsync(`${prefix}/status`, 'online', {
        retain: true,
        qos: 1,
      });
      await client.endAsync();
      return true;
    } catch (error) {
      this.uiLog.error('MQTT connection check failed:', error);
      return false;
    }
  }

  private buildBrewPayload(brew: Brew): object {
    const bean = brew.getBean();
    const prep = brew.getPreparation();
    const mill = brew.getMill();
    const water = brew.getWater();

    return {
      brew_date: new Date(brew.config.unix_timestamp * 1000).toISOString(),
      bean_name: bean?.name || '',
      bean_roaster: bean?.roaster || '',
      bean_roast: bean?.roast != null ? String(bean.roast) : '',
      bean_roasting_date: bean?.roastingDate || '',
      preparation_name: prep?.name || '',
      preparation_type: prep?.type != null ? String(prep.type) : '',
      preparation_style: prep?.style_type != null ? String(prep.style_type) : '',
      mill_name: mill?.name || '',
      water_name: water?.name || '',
      grind_size: brew.grind_size,
      grind_weight: brew.grind_weight,
      brew_temperature: brew.brew_temperature,
      brew_time: brew.brew_time,
      brew_time_ms: brew.brew_time_milliseconds,
      brew_quantity: brew.brew_quantity,
      brew_quantity_type: brew.brew_quantity_type != null ? String(brew.brew_quantity_type) : '',
      brew_beverage_quantity: brew.brew_beverage_quantity,
      tds: brew.tds,
      rating: brew.rating,
      note: brew.note,
      ratio: brew.getBrewRatio(),
      favourite: brew.favourite,
      best_brew: brew.best_brew,
    };
  }

  public async publishBrewData(brew: Brew): Promise<void> {
    const settings: Settings = this.uiSettingsStorage.getSettings();
    const prefix = settings.mqtt_topic_prefix || 'beanconqueror';

    try {
      const client = await this.connect();

      // Publish latest brew
      await client.publishAsync(
        `${prefix}/brew/latest`,
        JSON.stringify(this.buildBrewPayload(brew)),
        { retain: true, qos: 1 },
      );

      // Mark this brew as published
      brew.customInformation.mqtt_published = true;
      await this.uiBrewStorage.update(brew);

      // Catch up any previously unpublished brews
      await this.publishUnpublishedBrews(client, prefix);

      // Refresh recent brews and active beans
      await this.publishRecentBrews(client, prefix, settings);
      await this.publishActiveBeans(client, prefix);

      await client.publishAsync(`${prefix}/status`, 'online', {
        retain: true,
        qos: 1,
      });

      await client.endAsync();
      this.uiLog.info('MQTT brew data published successfully');
    } catch (error) {
      this.uiLog.error('MQTT publish error:', error);
    }
  }

  private async publishUnpublishedBrews(
    client: mqtt.MqttClient,
    prefix: string,
  ): Promise<void> {
    const unpublished = this.uiBrewStorage
      .getAllEntries()
      .filter((b) => !b.customInformation?.mqtt_published);

    for (const brew of unpublished) {
      try {
        await client.publishAsync(
          `${prefix}/brew/${brew.config.uuid}`,
          JSON.stringify(this.buildBrewPayload(brew)),
          { retain: false, qos: 1 },
        );
        brew.customInformation.mqtt_published = true;
        await this.uiBrewStorage.update(brew);
      } catch (error) {
        this.uiLog.error(
          `MQTT: failed to publish brew ${brew.config.uuid}:`,
          error,
        );
      }
    }
  }

  private async publishRecentBrews(
    client: mqtt.MqttClient,
    prefix: string,
    settings: Settings,
  ): Promise<void> {
    const count = settings.mqtt_publish_recent_brews_count || 5;
    const allBrews = this.uiBrewStorage
      .getAllEntries()
      .sort((a, b) => b.config.unix_timestamp - a.config.unix_timestamp)
      .slice(0, count);

    const payload = {
      brews: allBrews.map((b) => ({
        brew_date: new Date(b.config.unix_timestamp * 1000).toISOString(),
        bean_name: b.getBean()?.name || '',
        preparation_name: b.getPreparation()?.name || '',
        grind_weight: b.grind_weight,
        brew_quantity: b.brew_quantity,
        rating: b.rating,
      })),
      count: allBrews.length,
    };

    await client.publishAsync(
      `${prefix}/brews/recent`,
      JSON.stringify(payload),
      { retain: true, qos: 1 },
    );
  }

  private async publishActiveBeans(
    client: mqtt.MqttClient,
    prefix: string,
  ): Promise<void> {
    const activeBeans = this.uiBeanStorage
      .getAllEntries()
      .filter((b) => !b.finished);

    const payload = activeBeans.map((b) => ({
      name: b.name,
      roaster: b.roaster,
      roasting_date: b.roastingDate,
      weight: b.weight,
      rating: b.rating,
    }));

    await client.publishAsync(
      `${prefix}/beans/active`,
      JSON.stringify(payload),
      { retain: true, qos: 1 },
    );
  }

  public async publishAllUnpublished(): Promise<void> {
    const settings: Settings = this.uiSettingsStorage.getSettings();
    const prefix = settings.mqtt_topic_prefix || 'beanconqueror';

    try {
      const client = await this.connect();

      await this.publishUnpublishedBrews(client, prefix);
      await this.publishRecentBrews(client, prefix, settings);
      await this.publishActiveBeans(client, prefix);

      await client.endAsync();
      this.uiToast.showInfoToastBottom('MQTT.PUBLISH.SUCCESSFULLY');
    } catch (error) {
      this.uiLog.error('MQTT publish all error:', error);
      this.uiToast.showInfoToastBottom('MQTT.PUBLISH.UNSUCCESSFULLY');
    }
  }

  public howManyBrewsAreNotPublishedToMqtt(): number {
    const brewEntries = this.uiBrewStorage.getAllEntries();
    return brewEntries.filter((b) => !b.customInformation?.mqtt_published)
      .length;
  }
}
