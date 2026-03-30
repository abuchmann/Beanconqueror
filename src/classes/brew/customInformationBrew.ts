import { ICustomInformationBrew } from '../../interfaces/brew/ICustomInformationBrew';

export class CustomInformationBrew implements ICustomInformationBrew {
  public visualizer_id: string;
  public mqtt_published: boolean;

  constructor() {
    this.visualizer_id = '';
    this.mqtt_published = false;
  }
}
