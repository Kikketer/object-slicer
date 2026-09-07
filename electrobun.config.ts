import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Object Slicer",
		identifier: "com.cjweed.objectslicer",
		version: "1.0.0",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
			icons: "assets/icon.iconset",
			codesign: true,
			notarize: true,
			createDmg: true,
		},
		linux: {
			bundleCEF: false,
			icon: "assets/ObjectSlicer.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/ObjectSlicer.ico",
		},
	},
} satisfies ElectrobunConfig;
