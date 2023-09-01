import { MMKVLoader } from "react-native-mmkv-storage";

const Storage = new MMKVLoader()
    .withInstanceID("supertokens-storage")
    .withEncryption()
    .initialize();

export { Storage }
