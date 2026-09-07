import ServerOptionCtrl from '../src/controller/ServerOptionCtrl';
import CertificationCtrl from '../src/controller/CertificationCtrl';

(window as any).adminControllers = {server: ServerOptionCtrl.instance, certificates: CertificationCtrl.instance};
