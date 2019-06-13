


function TStreamEncoder(DeviceName,StreamName,FramePostProcess,RenderFunc,OnFirstMeta,OnError)
{
	OnFirstMeta = OnFirstMeta || function(){};
	
	const EncodeQuality = 2;

	this.Device = new Pop.Media.Source(DeviceName);

	this.Window = new Pop.Opengl.Window(StreamName);
	this.Window.OnRender = RenderFunc.bind(this);
	this.Window.OnMouseMove = function () { };

	this.Encoder = new Pop.Media.H264Encoder(EncodeQuality);
	this.Encoder.Metas = [];

	this.InputImage = Pop.CreateColourTexture([255, 0, 0, 255]);
	this.OutputImage = Pop.CreateColourTexture([0, 255, 0, 255]);

	this.OnInputImageChanged = function (NewImage)
	{
		this.InputImage = NewImage;
	}

	this.OnOutputImageChanged = function (NewImage)
	{
		this.OutputImage = NewImage;
	}

	ProcessKinectFrames(this.Device, this.Encoder, FramePostProcess, this.OnInputImageChanged.bind(this), OnFirstMeta.bind(this) ).then(Pop.Debug).catch(OnError);
	ProcessEncoding(this.Encoder,this.OnOutputImageChanged.bind(this)).then(Pop.Debug).catch(OnError);
}
